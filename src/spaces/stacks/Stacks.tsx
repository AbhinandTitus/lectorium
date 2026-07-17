import { useNavigation } from "../../state/navigation";

/** M0 placeholder. M1 builds the real searchable library here. */
export function Stacks() {
  const goTo = useNavigation((s) => s.goTo);

  return (
    <main className="space-placeholder" aria-label="Stacks">
      <h1>Stacks</h1>
      <p>The library arrives in Milestone 1.</p>
      <button onClick={() => goTo("room")}>Back to the room</button>
    </main>
  );
}
