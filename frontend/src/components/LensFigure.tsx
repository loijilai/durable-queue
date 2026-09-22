import { useState } from "react";

// 同一張圖的幾個切面（Security 的拓撲鏡頭）或同一條管線的幾個步驟（Appendix
// 的部署管線），一次只顯示一個，caption 跟著切換。兩頁共用，所以抽成元件；
// class 沿用原本 Security 頁的 sec-lens-*，不為了搬家改名。
export interface Lens {
  id: string;
  tab: string;
  caption: string;
  src?: string | null;
}

function LensFigure({
  lenses,
  label,
  navigation = "tabs",
}: {
  lenses: Lens[];
  label: string;
  navigation?: "tabs" | "overlay-arrows";
}) {
  const [lensId, setLensId] = useState(lenses[0].id);
  const lensIndex = Math.max(
    lenses.findIndex((lens) => lens.id === lensId),
    0,
  );
  const lens = lenses[lensIndex];
  const previousLens = lenses[(lensIndex - 1 + lenses.length) % lenses.length];
  const nextLens = lenses[(lensIndex + 1) % lenses.length];
  const usesOverlayNavigation = navigation === "overlay-arrows";

  return (
    <div className="sec-lens">
      {!usesOverlayNavigation && (
        <div className="sec-lens-tabs" role="tablist" aria-label={label}>
          {lenses.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === lensId}
              aria-label={item.tab}
              className={`sec-lens-tab${
                item.id === lensId ? " is-active" : ""
              }`}
              onClick={() => setLensId(item.id)}
            >
              {item.tab}
            </button>
          ))}
        </div>
      )}

      <figure className="sec-lens-frame">
        <div className="sec-lens-visual">
          {lens.src ? (
            <img src={lens.src} alt={lens.tab} />
          ) : (
            <div
              className="sec-mock"
              role="img"
              aria-label={`${lens.tab} diagram placeholder`}
            >
              <span className="sec-mock-tag">DIAGRAM PENDING</span>
              <span className="sec-mock-name">{lens.tab}</span>
              <span className="sec-mock-hint">
                one .drawio, three layers, three SVG exports
              </span>
            </div>
          )}
          {usesOverlayNavigation && (
            <>
              <button
                type="button"
                className="sec-lens-nav sec-lens-prev"
                onClick={() => setLensId(previousLens.id)}
                aria-label={`Previous ${label}: ${previousLens.tab}`}
              >
                <span aria-hidden="true">{"<"}</span>
              </button>
              <button
                type="button"
                className="sec-lens-nav sec-lens-next"
                onClick={() => setLensId(nextLens.id)}
                aria-label={`Next ${label}: ${nextLens.tab}`}
              >
                <span aria-hidden="true">{">"}</span>
              </button>
            </>
          )}
        </div>
        <figcaption>{lens.caption}</figcaption>
      </figure>
    </div>
  );
}

export default LensFigure;
