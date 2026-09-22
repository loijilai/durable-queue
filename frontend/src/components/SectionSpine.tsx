// 頁首的導覽 tile（也是全頁目錄）和各節標題吃同一份資料——導覽和內文因此
// 不可能對不上。Security 與 Appendix 兩頁共用；class 沿用原本的 sec-*。
export interface SpineSection {
  id: string;
  index: string;
  tier: string;
  title: string;
}

export function SectionSpine({
  sections,
  label,
}: {
  sections: SpineSection[];
  label: string;
}) {
  return (
    <nav className="sec-spine" aria-label={label}>
      {sections.map((section) => (
        <a key={section.id} href={`#${section.id}`} className="sec-spine-tile">
          <span className="sec-spine-index">{section.index}</span>
          <span className="sec-spine-tier">{section.tier}</span>
          <span className="sec-spine-title">{section.title}</span>
        </a>
      ))}
    </nav>
  );
}

export function SectionHead({ section }: { section: SpineSection }) {
  return (
    <div className="sec-section-head">
      <p className="eyebrow sec-section-tag">
        <span className="eyebrow-dot" />
        {section.index} · {section.tier}
      </p>
      <h2 className="sec-section-title">{section.title}</h2>
    </div>
  );
}
