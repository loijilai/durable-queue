/* 指向一支 YouTube 錄影的卡片，HighAvailability 與 Scalability 兩頁共用 ——
   兩頁指的都是「這段是對真實 AWS 錄下來的」。class 不帶頁面前綴，否則下一個
   使用者會以為自己在借用別頁的樣式。 */

function getYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    let id: string | null = null;

    if (host === "youtu.be") {
      id = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
    } else if (host === "youtube.com" || host === "m.youtube.com") {
      id =
        parsed.searchParams.get("v") ??
        parsed.pathname.match(/^\/(?:embed|shorts)\/([^/?]+)/)?.[1] ??
        null;
    }

    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/* 預覽只抓靜態縮圖，不載入 YouTube iframe；第三方播放器要等使用者點擊後才開啟。
   provenance 與 description 是不同性質的資訊：description 說這支影片在演什麼，
   provenance 說這份證據有多舊，所以放在卡片外、給它自己的視覺層級。不傳就不渲染。 */
function RecordingSlot({
  url,
  title,
  description,
  slotHint,
  provenance,
}: {
  url: string;
  title: string;
  description: string;
  slotHint: string;
  provenance?: string;
}) {
  const videoId = getYouTubeVideoId(url);

  return (
    <figure className="recording">
      {url ? (
        <a
          className="recording-card"
          href={url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Watch ${title} on YouTube`}
        >
          {videoId && (
            <span className="recording-thumbnail">
              <span className="recording-thumbnail-fallback">
                REAL AWS DEMO
              </span>
              <img
                src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
                alt=""
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
              />
              <span className="recording-play" aria-hidden="true">
                ▶
              </span>
            </span>
          )}
          <span className="recording-body">
            <span className="recording-platform">YouTube demo</span>
            <strong>{title}</strong>
            <span className="recording-description">{description}</span>
            <span className="recording-cta">Watch recording ↗</span>
          </span>
        </a>
      ) : (
        <p className="recording-slot">Recording slot — {slotHint}</p>
      )}
      {provenance && (
        <figcaption className="recording-provenance">{provenance}</figcaption>
      )}
    </figure>
  );
}

export default RecordingSlot;
