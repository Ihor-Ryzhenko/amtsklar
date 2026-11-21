import { LetterInput } from "@/components/letter-input/letter-input";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <h1 className="text-3xl font-semibold">Amtsklar</h1>
      <LetterInput />
    </main>
  );
}
