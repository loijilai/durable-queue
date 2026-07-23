import StoryDiagram from "../components/StoryDiagrams.tsx";
import { STORY_NODES } from "../lib/durabilityStory.ts";
import { useScrollReveal } from "../lib/useScrollReveal.ts";

function DurabilityWalkthroughPage() {
  const revealRef = useScrollReveal<HTMLDivElement>(STORY_NODES.length);

  return (
    <section className="durability-walkthrough">
      <p className="eyebrow">
        <span className="eyebrow-dot" />
        DURABILITY WALKTHROUGH
      </p>
      <h1>Why every piece of this queue exists</h1>
      <p className="placeholder-body">
        Scroll down to unfold how does the design decision is made.
      </p>

      <div className="story-nodes">
        {STORY_NODES.map((node, i) => (
          <div key={node.id} ref={revealRef(i)} className="story-node">
            <p className="eyebrow">
              <span className="eyebrow-dot" />
              {node.eyebrow}
            </p>
            <h3>{node.title}</h3>

            <dl className="story-node-facts">
              <dt>Problem</dt>
              <dd>{node.problem}</dd>
              <dt>Requirement</dt>
              <dd>{node.requirement}</dd>
              <dt>Solution</dt>
              <dd>{node.solution}</dd>
            </dl>

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
