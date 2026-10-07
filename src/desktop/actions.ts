import { abortTurn, isRunning, retryLastTurn, sendPrompt } from "@/lib/omp/state";

export { abortTurn, isRunning, retryLastTurn, sendPrompt };

export async function runSuggestion(prompt: string) {
  await sendPrompt(prompt);
}
