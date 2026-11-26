"""LoRA fine-tuning of a small text model for the two-step reader's structuring step.

Input: the transcript of a photo. Output: the compact JSON the app expects. The
system prompt is exactly what the app sends (ml/structurer/prompt.json, written by
scripts/export-structurer-prompt.ts), so training and use match.

    .venv-ml/Scripts/python.exe ml/structurer/train.py            # train, check, merge
    .venv-ml/Scripts/python.exe ml/structurer/train.py --check-only --run ml/runs/structurer/<run>

Local GPU only. The result is judged on the reporter's real photos with
`npm run ai:evaluate-chat`, never on the synthetic data alone.
"""

import argparse
import json
import math
import random
import time
from pathlib import Path

import torch
import torch.nn.functional as F
from huggingface_hub import snapshot_download
import urllib.request

from peft import LoraConfig, PeftModel, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer

BASE = "Qwen/Qwen3-0.6B"
PROMPT = json.loads(Path("ml/structurer/prompt.json").read_text(encoding="utf-8"))


# Ollama's JSON grammar writes object keys in alphabetical order whatever the schema says, so the
# answers are taught in that order; otherwise the grammar pushes the model off what it learned.
def messages(transcript, target=None):
    out = [{"role": "system", "content": PROMPT["system"]}, {"role": "user", "content": PROMPT["userPrefix"] + transcript}]
    if target is not None:
        out.append({"role": "assistant", "content": json.dumps(target, ensure_ascii=False, separators=(",", ":"), sort_keys=True)})
    return out


def prompt_text(tokenizer, transcript):
    return tokenizer.apply_chat_template(
        messages(transcript), tokenize=False, add_generation_prompt=True, enable_thinking=False
    )


def encode(tokenizer, row, max_len):
    prompt_ids = tokenizer(prompt_text(tokenizer, row["transcript"]), add_special_tokens=False)["input_ids"]
    full = tokenizer.apply_chat_template(messages(row["transcript"], row["target"]), tokenize=False, enable_thinking=False)
    ids = tokenizer(full, add_special_tokens=False)["input_ids"][:max_len]
    # Learn the answer only, not the instructions or the transcript.
    labels = [-100] * min(len(prompt_ids), len(ids)) + ids[len(prompt_ids):]
    return torch.tensor(ids), torch.tensor(labels[: len(ids)])


def answer_loss(model, ids, labels):
    """Loss on the answer only, computing predictions for the answer tokens alone: the full-vocabulary
    predictions for every prompt token would take about 1 GB on their own, too much for a 4 GB card."""
    keep = int((labels != -100).sum()) + 1
    logits = model(input_ids=ids[None].cuda(), logits_to_keep=keep).logits[0, :-1].float()
    return F.cross_entropy(logits, ids[-(keep - 1):].cuda())


def free_gpu():
    """Asks the local Ollama to unload its models, so training has the whole card."""
    try:
        with urllib.request.urlopen("http://localhost:11434/api/ps", timeout=5) as r:
            loaded = [m["name"] for m in json.loads(r.read())["models"]]
        for name in loaded:
            body = json.dumps({"model": name, "keep_alive": 0}).encode()
            urllib.request.urlopen(urllib.request.Request("http://localhost:11434/api/generate", body), timeout=30).read()
        if loaded:
            print("Unloaded from Ollama:", ", ".join(loaded), flush=True)
    except OSError:
        pass


def load_rows(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


@torch.no_grad()
def check(model, tokenizer, rows, limit):
    """Exact-match accuracy of whole answers and of individual fields on held-out synthetic examples."""
    model.eval()
    exact = fields = fields_ok = parsed = 0
    rows = rows[:limit]
    for row in rows:
        ids = tokenizer(prompt_text(tokenizer, row["transcript"]), return_tensors="pt", add_special_tokens=False).to(model.device)
        out = model.generate(**ids, max_new_tokens=900, do_sample=False, pad_token_id=tokenizer.eos_token_id)
        text = tokenizer.decode(out[0][ids["input_ids"].shape[1]:], skip_special_tokens=True).strip()
        try:
            got = json.loads(text)
            parsed += 1
        except json.JSONDecodeError:
            got = {}
        if not isinstance(got, dict):
            got = {}
        want = row["target"]
        exact += got == want
        got_meds = got.get("medicines") if isinstance(got.get("medicines"), list) else []
        for key, value in want.items():
            if key != "medicines":
                fields += 1
                fields_ok += got.get(key) == value
                continue
            for i, m in enumerate(value):
                g = got_meds[i] if i < len(got_meds) and isinstance(got_meds[i], dict) else {}
                for k, v in m.items():
                    fields += 1
                    fields_ok += g.get(k) == v
    n = max(1, len(rows))
    return {"examples": len(rows), "valid_json": parsed / n, "exact": exact / n, "field_accuracy": fields_ok / max(1, fields)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="ml/data/structurer")
    parser.add_argument("--real", default="ml/data/real", help="examples from submitted reports (npm run ml:export-learning)")
    parser.add_argument("--real-weight", type=int, default=3, help="times each real example is seen; corrected ones twice that")
    parser.add_argument("--runs", default="ml/runs/structurer")
    parser.add_argument("--run", default=None)
    parser.add_argument("--epochs", type=float, default=1.0)
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--accumulate", type=int, default=8)
    parser.add_argument("--max-len", type=int, default=1792)
    parser.add_argument("--check", type=int, default=60)
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--resume", default=None, help="a run folder with a checkpoint to continue from")
    args = parser.parse_args()
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    assert torch.cuda.is_available(), "A CUDA GPU is needed."

    # Uses the copy already on disk, so training runs with no internet; downloads only the first time.
    local = Path("ml/artifacts/qwen3-0.6b")
    base_dir = str(local) if (local / "model.safetensors").exists() else snapshot_download(BASE, local_dir=str(local))
    tokenizer = AutoTokenizer.from_pretrained(base_dir)
    val = load_rows(f"{args.data}/val.jsonl")

    if args.check_only:
        model = AutoModelForCausalLM.from_pretrained(Path(args.run) / "merged", dtype=torch.bfloat16).cuda()
        print(json.dumps(check(model, tokenizer, val, args.check), indent=2))
        hard_path = Path(f"{args.data}/hard.jsonl")
        if hard_path.exists():
            print("Held-out hard:", json.dumps(check(model, tokenizer, load_rows(hard_path), args.check), indent=2))
        return

    free_gpu()
    run = Path(args.resume) if args.resume else Path(args.runs) / time.strftime("%Y%m%d-%H%M%S")
    run.mkdir(parents=True, exist_ok=True)
    state_path = run / "checkpoint" / "state.json"
    done_updates = json.loads(state_path.read_text())["update"] if args.resume and state_path.exists() else 0
    train = load_rows(f"{args.data}/train.jsonl")
    real_path = Path(f"{args.real}/train.jsonl")
    real = load_rows(real_path) if real_path.exists() else []
    # Real reports teach what synthetic data cannot; the ones a reporter had to correct, most of all.
    for row in real:
        train += [row] * (args.real_weight * (2 if row.get("corrected") else 1))
    print(f"Training on {len(train)} examples ({len(real)} from real reports)", flush=True)
    model = AutoModelForCausalLM.from_pretrained(base_dir, dtype=torch.bfloat16).cuda()
    before = check(model, tokenizer, val, 20) if not done_updates else {"resumed_at_update": done_updates}
    print("Before training:", json.dumps(before), flush=True)
    model.gradient_checkpointing_enable()
    model.enable_input_require_grads()
    if done_updates:
        model = PeftModel.from_pretrained(model, run / "checkpoint", is_trainable=True)
        print(f"Resuming after update {done_updates}", flush=True)
    else:
        model = get_peft_model(model, LoraConfig(
            r=16, lora_alpha=32, lora_dropout=0.05, task_type="CAUSAL_LM",
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        ))
    model.print_trainable_parameters()
    optimiser = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr, weight_decay=0.0)
    order = [i % len(train) for i in range(int(len(train) * args.epochs))]
    random.shuffle(order)
    steps = math.ceil(len(order) / args.accumulate)
    schedule = torch.optim.lr_scheduler.LambdaLR(optimiser, lambda s: min(1.0, (s + 1) / 20) * max(0.0, 1 - s / steps))
    for _ in range(done_updates):
        schedule.step()
    model.train()
    started, running = time.time(), 0.0
    for step, index in enumerate(order, 1):
        if step <= done_updates * args.accumulate:
            continue  # the same seeded order, so a resumed run skips exactly what was done
        ids, labels = encode(tokenizer, train[index], args.max_len)
        loss = answer_loss(model, ids, labels) / args.accumulate
        loss.backward()
        running += loss.item()
        if step % args.accumulate == 0 or step == len(order):
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimiser.step()
            schedule.step()
            optimiser.zero_grad(set_to_none=True)
            update = math.ceil(step / args.accumulate)
            if update % 10 == 0:
                print(f"update {update}/{steps} loss {running / 10:.4f} {time.time() - started:.0f}s", flush=True)
                running = 0.0
            if update % 50 == 0 and update < steps:  # a crash or a busy GPU never costs more than 50 updates
                model.save_pretrained(run / "checkpoint")
                state_path.write_text(json.dumps({"update": update}))
    model.save_pretrained(run / "adapter")
    merged = model.merge_and_unload()
    merged.save_pretrained(run / "merged", safe_serialization=True)
    tokenizer.save_pretrained(run / "merged")
    result = check(merged, tokenizer, val, args.check)
    hard_path = Path(f"{args.data}/hard.jsonl")
    if hard_path.exists():
        result["hard"] = check(merged, tokenizer, load_rows(hard_path), args.check)
    real_test = Path(f"{args.real}/test.jsonl")
    if real_test.exists() and real_test.stat().st_size:
        result["real"] = check(merged, tokenizer, load_rows(real_test), 1000)
    result |= {"base": BASE, "before": before, "train_examples": len(train), "epochs": args.epochs,
               "seconds": round(time.time() - started), "data": "synthetic only; real photos are the test"}
    (run / "result.json").write_text(json.dumps(result, indent=2))
    print("After training:", json.dumps(result, indent=2), flush=True)
    print(f"Saved to {run}", flush=True)


if __name__ == "__main__":
    main()
