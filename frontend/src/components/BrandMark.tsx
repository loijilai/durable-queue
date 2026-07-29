/* 專案自己的標記（同一份幾何也是 public/favicon.svg）：缺口朝上的環是 retry
   loop，缺口右端那顆橘點是「當前這一輪」的頭。內聯而不是 <img src>，才能跟
   文字一起被 currentColor 之外的品牌色控制，也少一個請求。 */

type Props = { className?: string };

function BrandMark({ className }: Props) {
  return (
    <svg
      className={className}
      role="img"
      aria-label="durable-queue"
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="48" height="48" rx="11" fill="var(--ink)" />
      <circle
        cx="24"
        cy="24"
        r="11"
        fill="none"
        stroke="var(--canvas)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="55.3 13.8"
        transform="rotate(-54 24 24)"
      />
      <circle cx="30.5" cy="15.1" r="3.4" fill="var(--signal-orange)" />
    </svg>
  );
}

export default BrandMark;
