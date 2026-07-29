import { useEffect, useState } from "react";
import { API_BASE_URL } from "../lib/api.ts";

const TIMEOUT_MS = 5000;
const RETRY_MS = 30000;

/**
 * 後端（AWS stack）平常是關機的，demo 才 terraform apply 開起來。
 * 前端掛在 Vercel 上永遠在線，所以要主動告訴訪客「不是網站壞了，是後端沒開」。
 *
 * 只在「掛掉」時顯示，且一旦探到活著就停止輪詢 —— High Availability 那頁的
 * probe 是刻意要讓人看到紅格子的，這條 banner 不該跟著閃。
 */
function BackendStatus() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function check() {
      const controller = new AbortController();
      const abort = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let ok = false;
      try {
        const res = await fetch(`${API_BASE_URL}/health/`, {
          signal: controller.signal,
        });
        ok = res.ok;
      } catch {
        // 網路錯 / CORS 擋 / timeout 一律當作後端沒開
        ok = false;
      } finally {
        clearTimeout(abort);
      }
      if (cancelled) return;
      setOffline(!ok);
      // 活著就不再探；掛著才排下一次重試，等使用者等到後端開機。
      if (!ok) timer = setTimeout(check, RETRY_MS);
    }

    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="backend-banner" role="status">
      <span className="backend-banner-dot" />
      <span>
        <strong>Backend asleep.</strong> AWS stack is torn down between demos —
        live API calls will fail.
      </span>
    </div>
  );
}

export default BackendStatus;
