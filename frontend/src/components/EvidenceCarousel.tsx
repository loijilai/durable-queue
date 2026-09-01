import { useState, type KeyboardEvent, type ReactNode } from "react";

/* 一疊截圖，一次只露出一張。證據有四張，攤開來排會把頁面拉得比它們撐起的
   宣稱還長；疊起來則是每一張都拿到整個版面的寬度。

   切換的操作面是壓在圖片左右兩側的兩塊透明區域 —— 要點的是圖本身，不是圖
   底下的一排小按鈕。四張都留在 DOM 裡只切透明度，換頁因此沒有等圖載入的
   空窗，代價是首次進站四張一起下載（合計約 440 KB，都是自家 public 下的
   檔案）。 */

export type EvidenceSlide = {
  src: string;
  alt: string;
  /* 圖說可以是一段話，也可以是主圖那種四條線的 legend。 */
  caption: ReactNode;
};

function EvidenceCarousel({
  slides,
  label,
}: {
  slides: EvidenceSlide[];
  label: string;
}) {
  const [index, setIndex] = useState(0);

  /* 兩端相接：往後翻到底會回到第一張。沒有終點，就不需要把按鈕變成
     disabled，也就不會出現一個點了沒反應的區域。 */
  const step = (delta: number) =>
    setIndex((i) => (i + delta + slides.length) % slides.length);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowRight") step(1);
    else if (event.key === "ArrowLeft") step(-1);
    else return;
    event.preventDefault();
  }

  return (
    <figure
      className="ev-carousel"
      aria-roledescription="carousel"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      <div className="ev-frame">
        {slides.map((slide, i) => (
          <img
            key={slide.src}
            className={`ev-slide${i === index ? " is-current" : ""}`}
            src={slide.src}
            alt={slide.alt}
            aria-hidden={i === index ? undefined : true}
          />
        ))}

        {/* 操作面壓在圖上：左半往前、右半往後。它們是 <button>，所以鍵盤
            走 Tab 也拿得到，不用另外補 role。 */}
        <button
          type="button"
          className="ev-zone ev-zone--prev"
          onClick={() => step(-1)}
          aria-label="Previous panel"
        >
          <span className="ev-arrow" aria-hidden="true">
            ‹
          </span>
        </button>
        <button
          type="button"
          className="ev-zone ev-zone--next"
          onClick={() => step(1)}
          aria-label="Next panel"
        >
          <span className="ev-arrow" aria-hidden="true">
            ›
          </span>
        </button>
      </div>

      <div className="ev-dots">
        {slides.map((slide, i) => (
          <button
            key={slide.src}
            type="button"
            className={`ev-dot${i === index ? " is-current" : ""}`}
            onClick={() => setIndex(i)}
            aria-label={`Panel ${i + 1} of ${slides.length}`}
            aria-current={i === index ? "true" : undefined}
          />
        ))}
      </div>

      {/* 圖換了，圖說也換 —— 讀螢幕的人要聽得到這件事，所以這一塊是 live 的。 */}
      <figcaption className="ev-caption" aria-live="polite">
        {slides[index].caption}
      </figcaption>
    </figure>
  );
}

export default EvidenceCarousel;
