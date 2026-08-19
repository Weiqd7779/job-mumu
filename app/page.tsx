import type { Metadata } from "next";
import { chatGPTSignInPath, chatGPTSignOutPath } from "./chatgpt-auth";
import { getAppUser, isAllowedUser } from "@/lib/authz";
import { listRecentProjects } from "@/lib/analysis/pipeline";
import { Workspace, type RecentProject } from "./workspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "求職姆姆｜用證據看懂職缺",
  description:
    "分析台灣職缺技能、公司薪資與公開職場討論，再依確認事實準備履歷。",
};

export default async function Home() {
  const user = await getAppUser();
  if (!user) return <SignedOutLanding />;
  if (!isAllowedUser(user.email)) {
    return (
      <main className="centered-page">
        <div className="access-panel">
          <p className="eyebrow">INVITE ONLY</p>
          <h1>這個帳號尚未受邀</h1>
          <p>
            求職姆姆目前只開放三位測試使用者。請由開發者將你的電子郵件加入 allowlist。
          </p>
          <a className="text-link" href={chatGPTSignOutPath("/")}>
            使用其他帳號登入
          </a>
        </div>
      </main>
    );
  }

  let projects: RecentProject[] = [];
  try {
    projects = await listRecentProjects(user.email);
  } catch {
    projects = [];
  }

  return (
    <Workspace
      user={{
        displayName: user.displayName,
        email: user.email,
        isDeveloperPreview: user.isDeveloperPreview,
      }}
      initialProjects={projects}
      signOutHref={chatGPTSignOutPath("/")}
    />
  );
}

function SignedOutLanding() {
  return (
    <main className="landing">
      <header className="landing-header">
        <span className="wordmark">求職姆姆</span>
        <a className="secondary-button" href={chatGPTSignInPath("/")}>
          使用 ChatGPT 登入
        </a>
      </header>
      <section className="landing-hero">
        <p className="eyebrow">TAIWAN JOB EVIDENCE</p>
        <h1>
          看懂市場需要什麼，
          <br />
          再決定你該準備什麼。
        </h1>
        <p className="landing-copy">
          輸入職稱、貼上 JD 網址或完整內容。求職姆姆會把職缺統計、公開論壇訊號與
          Agent 建議分開，讓每個結論都有依據。
        </p>
        <a className="primary-button landing-cta" href={chatGPTSignInPath("/")}>
          登入後開始分析
        </a>
      </section>
      <section className="landing-proof" aria-label="產品原則">
        <div>
          <span>01</span>
          <strong>程式化統計</strong>
          <p>每個百分比同時顯示 n/N，不把樣本說成全市場。</p>
        </div>
        <div>
          <span>02</span>
          <strong>社群校準</strong>
          <p>論壇只用來理解職缺語境，不取代 JD 證據。</p>
        </div>
        <div>
          <span>03</span>
          <strong>履歷不捏造</strong>
          <p>只有明確要求履歷時才收集資料，所有內容連回事實卡。</p>
        </div>
      </section>
    </main>
  );
}
