# The pack-date helper (ml/detector/serve.py). The PyTorch image already has torch, torchvision and Pillow.
FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime
WORKDIR /app
COPY serve.py .
EXPOSE 11500
