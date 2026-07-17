import { useNavigation } from "../../state/navigation";

/** M0 placeholder. The Reader is the product; it is built in M1–M2. */
export function Reader() {
  const goTo = useNavigation((s) => s.goTo);

  return (
    <main className="space-placeholder" aria-label="Reader">
      <h1>Reader</h1>
      <p>The reading surface arrives in Milestone 1.</p>
      <button onClick={() => goTo("room")}>Back to the room</button>
    </main>
  );
}
