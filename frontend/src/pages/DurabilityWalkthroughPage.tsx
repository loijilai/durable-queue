import DurabilityStepper from "../components/DurabilityStepper.tsx";
import StoryDiagram from "../components/StoryDiagrams.tsx";
import { STORY_NODES } from "../lib/durabilityStory.ts";
import { useScrollReveal } from "../lib/useScrollReveal.ts";

// Steps 1–3 share one architecture diagram and are shown in a fixed-frame stepper;
// steps 4–5 remain individual scroll-reveal cards.
const STEPPER_NODES = STORY_NODES.slice(0, 3);
const CARD_NODES = STORY_NODES.slice(3);

function DurabilityWalkthroughPage() {
  // One reveal target for the stepper card + one per standalone card.
  const revealRef = useScrollReveal<HTMLDivElement>(1 + CARD_NODES.length);

  return (
    <section className="durability-walkthrough">
      <p className="eyebrow">
        <span className="eyebrow-dot" />
        DURABILITY WALKTHROUGH
      </p>
      <h1>Why every piece of this queue exists</h1>
      <p className="placeholder-body">
        Problem: How do we make a job system durable?
      </p>

      <div className="story-nodes">
        <div ref={revealRef(0)} className="story-node">
          <DurabilityStepper nodes={STEPPER_NODES} />
        </div>

        {CARD_NODES.map((node, i) => (
          <div key={node.id} ref={revealRef(i + 1)} className="story-node">
            <p className="eyebrow">
              <span className="eyebrow-dot" />
              {node.eyebrow}
            </p>
            <h3>{node.title}</h3>

            <p className="story-node-term">{node.term}</p>
            <p className="story-node-desc">{node.description}</p>

            <div className="story-node-diagram">
              <StoryDiagram nodeId={node.id} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default DurabilityWalkthroughPage;
