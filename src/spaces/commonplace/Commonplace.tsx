import { useNavigation } from "../../state/navigation";

/** M0 placeholder. M3 builds the real commonplace book here. */
export function Commonplace() {
  const goTo = useNavigation((s) => s.goTo);

  return (
    <main className="space-placeholder" aria-label="Commonplace">
      <h1>Commonplace</h1>
      <p>Your quotes, notes, and vocabulary arrive in Milestone 3.</p>
      <button onClick={() => goTo("room")}>Back to the room</button>
    </main>
  );
}
