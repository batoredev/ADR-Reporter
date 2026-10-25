import "server-only";
import { notFound } from "next/navigation";
import { WorkflowError } from "./errors";

/** Shows the 404 page for cases the user may not see, without revealing that they exist. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof WorkflowError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
