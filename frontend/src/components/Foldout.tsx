import type { ReactNode } from 'react'

// 一個標題、一個開關，底下整塊內容一起收放。HA / Scalability 頁拿它裝「HOW TO
// RUN」+「WHY IT SURVIVES / SCALES」那兩欄：那是「決定要動手時才需要」的內容，
// 攤開在瀏覽路徑上，讀者每一節都得先跳過兩欄散文才走得到下一個 demo。
// 兩欄共用一個開關而不是各自收放——它們是同一個問題的兩半，會看其中一個的人
// 兩個都要看，拆成兩個開關只是逼人多點一次。
//
// 用原生 <details> 而不是自己拿 useState 做：鍵盤操作、Ctrl-F 展開（現代瀏覽
// 器會為了搜尋自動打開）、以及 aria-expanded 都由瀏覽器負責，寫不壞。
function Foldout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="foldout">
      <summary className="eyebrow foldout-summary">
        <span className="eyebrow-dot" />
        {title}
        <span className="foldout-chevron" aria-hidden="true">
          ▸
        </span>
      </summary>
      {children}
    </details>
  )
}

export default Foldout
