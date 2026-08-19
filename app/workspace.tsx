"use client";

import { useState } from "react";
import type { ReportPayload, RunSnapshot } from "@/lib/analysis/pipeline";
import type { ResumeDraft } from "@/lib/ai/resume";

export type RecentProject = {
  id: string;
  title: string;
  targetRole: string;
  status: string;
  updatedAt: string;
};

type IntentPreview = {
  type: "market" | "single_jd_url" | "single_jd_text";
  targetRole: string;
  resumeRequested: boolean;
  needsConfirmation: boolean;
  sourceHost?: string;
  warnings: string[];
  proposedSources: string[];
  paidOperations: string[];
};

const stageLabels: Record<string, string> = {
  intent: "確認分析意圖",
  collection: "取得允許的資料",
  clustering: "建立職缺群組",
  statistics: "統計技能需求",
  salary: "比對公司公開薪資",
  community: "搜尋公開論壇訊號",
  analysis: "Agent 產生證據式建議",
  report: "建立報告版本",
};

const exampleInputs = ["AI Agent 工程師", "設備工程師", "貼上 JD 網址"];

export function Workspace({
  user,
  initialProjects,
  signOutHref,
}: {
  user: { displayName: string; email: string; isDeveloperPreview: boolean };
  initialProjects: RecentProject[];
  signOutHref: string;
}) {
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<IntentPreview | null>(null);
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState(initialProjects);
  const [activeView, setActiveView] = useState<"home" | "report">("home");

  async function inspectInput() {
    if (input.trim().length < 2 || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const body = (await response.json()) as {
        intent?: IntentPreview;
        error?: string;
      };
      if (!response.ok || !body.intent) throw new Error(body.error ?? "intent_failed");
      setPreview(body.intent);
    } catch (caught) {
      setError(messageForError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function startAnalysis(forceNewProject = false) {
    if (!preview || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, forceNewProject }),
      });
      const body = (await response.json()) as {
        run?: RunSnapshot;
        error?: string;
      };
      if (!response.ok || !body.run) throw new Error(body.error ?? "run_create_failed");
      setRun(body.run);
      setPreview(null);
      setActiveView("report");
      await continueRun(body.run);
    } catch (caught) {
      setError(messageForError(caught));
      setBusy(false);
    }
  }

  async function continueRun(initialRun: RunSnapshot) {
    let current = initialRun;
    setBusy(true);
    try {
      while (current.status === "running" || current.status === "queued") {
        const response = await fetch(`/api/runs/${current.id}/advance`, {
          method: "POST",
        });
        const body = (await response.json()) as {
          run?: RunSnapshot;
          error?: string;
        };
        if (!response.ok || !body.run) {
          throw new Error(body.error ?? "run_advance_failed");
        }
        current = body.run;
        setRun(current);
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
      await refreshProjects();
    } catch (caught) {
      setError(messageForError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function retryRun(initialRun: RunSnapshot) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/runs/${initialRun.id}/advance`, {
        method: "POST",
      });
      const body = (await response.json()) as {
        run?: RunSnapshot;
        error?: string;
      };
      if (!response.ok || !body.run) {
        throw new Error(body.error ?? "run_retry_failed");
      }
      setRun(body.run);
      if (body.run.status === "running" || body.run.status === "queued") {
        await continueRun(body.run);
      }
    } catch (caught) {
      setError(messageForError(caught));
      setBusy(false);
    }
  }

  async function refreshProjects() {
    try {
      const response = await fetch("/api/projects");
      const body = (await response.json()) as { projects?: RecentProject[] };
      if (response.ok && body.projects) setProjects(body.projects);
    } catch {
      // The completed report remains usable even if the recent list refresh fails.
    }
  }

  async function openProject(projectId: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}`);
      const body = (await response.json()) as {
        run?: RunSnapshot;
        error?: string;
      };
      if (!response.ok || !body.run) {
        throw new Error(body.error ?? "project_open_failed");
      }
      setRun(body.run);
      setActiveView("report");
    } catch (caught) {
      setError(messageForError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function setCluster(clusterId: string, included: boolean) {
    if (!run || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/runs/${run.id}/clusters/${clusterId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ included }),
        },
      );
      const body = (await response.json()) as {
        run?: RunSnapshot;
        error?: string;
      };
      if (!response.ok || !body.run) {
        throw new Error(body.error ?? "cluster_update_failed");
      }
      setRun(body.run);
      await continueRun(body.run);
    } catch (caught) {
      setError(messageForError(caught));
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          className="wordmark wordmark-button"
          onClick={() => setActiveView("home")}
        >
          求職姆姆
        </button>
        <nav className="top-nav" aria-label="主要導覽">
          <button
            className={activeView === "home" ? "active" : ""}
            onClick={() => setActiveView("home")}
          >
            求職專案
          </button>
          <button
            className={activeView === "report" ? "active" : ""}
            onClick={() => run && setActiveView("report")}
            disabled={!run}
          >
            分析報告
          </button>
          <button disabled>履歷工作室</button>
          <button disabled>資料來源</button>
        </nav>
        <details className="account-menu">
          <summary aria-label="帳號選單">
            {displayInitial(user.displayName)}
          </summary>
          <div>
            <strong>{user.displayName}</strong>
            <span>{user.email}</span>
            {user.isDeveloperPreview && <span>本機預覽模式</span>}
            <a href={signOutHref}>登出</a>
          </div>
        </details>
      </header>

      {activeView === "home" ? (
        <HomeView
          input={input}
          setInput={(value) => {
            setInput(value);
            setPreview(null);
            setError("");
          }}
          busy={busy}
          preview={preview}
          error={error}
          projects={projects}
          inspectInput={inspectInput}
          startAnalysis={startAnalysis}
          openProject={openProject}
        />
      ) : (
        <ReportView
          run={run}
          busy={busy}
          error={error}
          onRetry={() => run && retryRun(run)}
          onToggleCluster={setCluster}
          onNewAnalysis={() => {
            setActiveView("home");
            setInput("");
            setPreview(null);
          }}
        />
      )}
    </div>
  );
}

function HomeView({
  input,
  setInput,
  busy,
  preview,
  error,
  projects,
  inspectInput,
  startAnalysis,
  openProject,
}: {
  input: string;
  setInput: (value: string) => void;
  busy: boolean;
  preview: IntentPreview | null;
  error: string;
  projects: RecentProject[];
  inspectInput: () => void;
  startAnalysis: (forceNewProject?: boolean) => void;
  openProject: (projectId: string) => void;
}) {
  return (
    <main className="home-page">
      <section className="input-hero">
        <p className="eyebrow">START WITH WHAT YOU KNOW</p>
        <h1>
          看懂市場需要什麼，
          <br />
          再決定你該準備什麼。
        </h1>
        <p className="hero-copy">
          輸入職稱、貼上 JD 網址，或直接貼上職缺內容。若你明確要求履歷，才會進一步請你提供個人資料。
        </p>
        <div className={`unified-input ${preview ? "has-preview" : ""}`}>
          <label htmlFor="job-input">職稱、JD 網址或職缺內容</label>
          <textarea
            id="job-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="例如：AI Agent 工程師，或貼上 https://…"
            rows={input.length > 120 ? 7 : 3}
          />
          <div className="input-footer">
            <div className="examples" aria-label="輸入範例">
              {exampleInputs.map((example) => (
                <button key={example} onClick={() => setInput(example)}>
                  {example}
                </button>
              ))}
            </div>
            <button
              className="primary-button"
              onClick={inspectInput}
              disabled={busy || input.trim().length < 2}
            >
              {busy ? "正在辨識…" : "分析這個方向"}
            </button>
          </div>
        </div>
      </section>

      {error && <ErrorNotice message={error} />}
      {preview && (
        <IntentCard
          preview={preview}
          busy={busy}
          onConfirm={() => startAnalysis(false)}
          onNew={() => startAnalysis(true)}
        />
      )}

      {projects.length > 0 && (
        <section className="recent-projects">
          <div className="section-heading">
            <div>
              <p className="eyebrow">RECENT PROJECTS</p>
              <h2>最近的求職專案</h2>
            </div>
            <span>相似職稱會建立新版報告，不覆蓋舊資料。</span>
          </div>
          <div className="project-list">
            {projects.map((project) => (
              <article key={project.id}>
                <div>
                  <h3>{project.title}</h3>
                  <p>{project.targetRole}</p>
                </div>
                <span className={`status-label status-${project.status}`}>
                  {projectStatus(project.status)}
                </span>
                <time>{formatDate(project.updatedAt)}</time>
                <button
                  className="quiet-button"
                  onClick={() => openProject(project.id)}
                  disabled={busy}
                >
                  開啟
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function IntentCard({
  preview,
  busy,
  onConfirm,
  onNew,
}: {
  preview: IntentPreview;
  busy: boolean;
  onConfirm: () => void;
  onNew: () => void;
}) {
  return (
    <section className="intent-card" aria-live="polite">
      <div className="intent-label">
        <span>系統理解</span>
        <strong>{intentTypeLabel(preview.type)}</strong>
      </div>
      <div className="intent-body">
        <h2>{preview.targetRole}</h2>
        <dl>
          <div>
            <dt>準備執行</dt>
            <dd>
              {preview.type === "market"
                ? "蒐集相關職缺、分群、統計技能，再加入薪資與論壇校準。"
                : "直接分析這份 JD，再加入公司薪資與論壇校準。"}
            </dd>
          </div>
          <div>
            <dt>資料來源</dt>
            <dd>{preview.proposedSources.join("、")}</dd>
          </div>
          <div>
            <dt>付費操作</dt>
            <dd>{preview.paidOperations.join("、")}</dd>
          </div>
          <div>
            <dt>履歷資料</dt>
            <dd>
              {preview.resumeRequested
                ? "分析完成後才會要求上傳。"
                : "本次不要求上傳。"}
            </dd>
          </div>
        </dl>
        {preview.warnings.map((warning) => (
          <p className="intent-warning" key={warning}>
            {warning}
          </p>
        ))}
        <div className="intent-actions">
          <button className="primary-button" disabled={busy} onClick={onConfirm}>
            確認並開始
          </button>
          <button className="secondary-button" disabled={busy} onClick={onNew}>
            建立獨立新專案
          </button>
        </div>
      </div>
    </section>
  );
}

function ReportView({
  run,
  busy,
  error,
  onRetry,
  onToggleCluster,
  onNewAnalysis,
}: {
  run: RunSnapshot | null;
  busy: boolean;
  error: string;
  onRetry: () => void;
  onToggleCluster: (clusterId: string, included: boolean) => void;
  onNewAnalysis: () => void;
}) {
  if (!run) {
    return (
      <main className="centered-page">
        <div className="access-panel">
          <h1>尚未開始分析</h1>
          <button className="primary-button" onClick={onNewAnalysis}>
            回到首頁
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="report-page">
      <aside className="report-nav">
        <p className="eyebrow">目前專案</p>
        <h2>{run.projectTitle}</h2>
        <nav aria-label="報告章節">
          <a href="#overview">分析總覽</a>
          <a href="#skills">技能證據</a>
          <a href="#clusters">職缺群組</a>
          <a href="#salary">公司薪資</a>
          <a href="#community">社群觀察</a>
        </nav>
        <button className="quiet-button" onClick={onNewAnalysis}>
          ＋ 新的分析
        </button>
      </aside>
      <div className="report-main">
        <div className="report-toolbar">
          <div>
            <span>專案 / {run.targetRole}</span>
            <strong>
              {run.status === "complete"
                ? "分析完成"
                : run.status === "failed"
                  ? "需要處理"
                  : "分析進行中"}
            </strong>
          </div>
          <button
            className="secondary-button"
            disabled={!run.report}
            onClick={() => run.report && downloadReport(run.report)}
          >
            匯出報表
          </button>
        </div>

        {(run.status === "running" || run.status === "queued") && (
          <ProgressPanel run={run} />
        )}
        {error && <ErrorNotice message={error} />}
        {run.status === "failed" && (
          <section className="partial-notice">
            <div>
              <strong>這個階段無法完成</strong>
              <p>{run.errorMessage ?? "請稍後重試。"}</p>
            </div>
            <button className="secondary-button" onClick={onRetry} disabled={busy}>
              重試目前階段
            </button>
          </section>
        )}
        {run.report && (
          <ReportContent
            run={run}
            report={run.report}
            busy={busy}
            onToggleCluster={onToggleCluster}
          />
        )}
      </div>
    </main>
  );
}

function ProgressPanel({ run }: { run: RunSnapshot }) {
  const currentIndex = Object.keys(stageLabels).indexOf(run.stage);
  return (
    <section className="progress-panel" aria-live="polite">
      <div className="progress-top">
        <div>
          <p className="eyebrow">ANALYSIS PIPELINE</p>
          <h1>{run.targetRole}</h1>
        </div>
        <strong>{run.progress}%</strong>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuenow={run.progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <i style={{ width: `${run.progress}%` }} />
      </div>
      <ol className="stage-list">
        {Object.entries(stageLabels).map(([key, label], index) => (
          <li
            key={key}
            className={
              index < currentIndex
                ? "done"
                : key === run.stage
                  ? "current"
                  : ""
            }
          >
            <span>{index < currentIndex ? "✓" : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <p className="progress-note">
        已保留 {run.sampleCount} 份本次樣本；完成的階段會保存，單一來源失敗不會清除全部結果。
      </p>
    </section>
  );
}

function ReportContent({
  run,
  report,
  busy,
  onToggleCluster,
}: {
  run: RunSnapshot;
  report: ReportPayload;
  busy: boolean;
  onToggleCluster: (clusterId: string, included: boolean) => void;
}) {
  const maxN = Math.max(...report.skillStats.map((item) => item.n), 1);
  const sourceEntries = Object.entries(report.sources);
  const communitySummary = report.communitySummary ?? {
    count: report.community.length,
    sourceCount: new Set(report.community.map((item) => item.source)).size,
    firsthandCount: report.community.filter((item) => item.firsthand === true).length,
    thresholdMet:
      report.community.length >= 3 &&
      new Set(report.community.map((item) => item.source)).size >= 2 &&
      report.community.some((item) => item.firsthand === true),
  };
  const [resumeOpen, setResumeOpen] = useState(false);
  const [resumeSource, setResumeSource] = useState("");
  const [resumeLanguage, setResumeLanguage] = useState<"zh-TW" | "en">("zh-TW");
  const [resumeConfirmed, setResumeConfirmed] = useState(false);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeError, setResumeError] = useState("");
  const [resumeDraft, setResumeDraft] = useState<ResumeDraft | null>(null);
  const [problemOpen, setProblemOpen] = useState(false);
  const [problemCategory, setProblemCategory] = useState("recommendation");
  const [problemMessage, setProblemMessage] = useState("");
  const [problemStatus, setProblemStatus] = useState("");

  async function generateResume() {
    if (!resumeConfirmed || resumeSource.trim().length < 20 || resumeBusy) return;
    setResumeBusy(true);
    setResumeError("");
    try {
      const response = await fetch("/api/resumes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: run.projectId,
          runId: run.id,
          sourceText: resumeSource,
          language: resumeLanguage,
          confirmed: true,
        }),
      });
      const body = (await response.json()) as {
        resume?: ResumeDraft;
        error?: string;
      };
      if (!response.ok || !body.resume) {
        throw new Error(body.error ?? "resume_generation_failed");
      }
      setResumeDraft(body.resume);
    } catch (caught) {
      setResumeError(messageForError(caught));
    } finally {
      setResumeBusy(false);
    }
  }

  async function deleteResumeData() {
    if (resumeBusy) return;
    setResumeBusy(true);
    setResumeError("");
    try {
      const response = await fetch("/api/resumes", { method: "DELETE" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "resume_data_deletion_failed");
      }
      setResumeDraft(null);
      setResumeSource("");
      setResumeConfirmed(false);
      setResumeError("已刪除求職姆姆中的履歷事實卡與履歷版本。本機檔案不受影響。");
    } catch (caught) {
      setResumeError(messageForError(caught));
    } finally {
      setResumeBusy(false);
    }
  }

  async function submitProblem() {
    setProblemStatus("送出中…");
    try {
      const response = await fetch("/api/problems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: run.projectId,
          runId: run.id,
          category: problemCategory,
          message: problemMessage,
        }),
      });
      if (!response.ok) throw new Error("problem_report_failed");
      setProblemStatus("已收到。這筆問題會成為後續回歸測試案例。");
      setProblemMessage("");
    } catch {
      setProblemStatus("送出失敗，請稍後再試。");
    }
  }

  return (
    <>
      <section className="report-title" id="overview">
        <div>
          <p className="eyebrow">MARKET EVIDENCE / V{report.reportVersion}</p>
          <h1>
            {report.targetRole}
            <br />
            台灣職缺觀測
          </h1>
          <p>
            本次保留 {report.sampleCount} 份職缺；程式掃描 {report.scannedCount} 筆公開資料。
            所有百分比都只代表本次樣本。
          </p>
        </div>
        <div className="sample-stamp">
          <span>本次樣本</span>
          <strong>{report.sampleCount}</strong>
          <small>版本 {report.reportVersion}</small>
        </div>
      </section>

      <section className="agent-statement">
        <div>
          <span>Agent 結論</span>
          <small>信心：{confidenceLabel(report.agent.confidence)}</small>
          <small>
            Skill：{report.agentTrace.skillName} v
            {report.agentTrace.skillVersion} ·{" "}
            {report.agentTrace.status === "validated"
              ? "schema／證據驗證通過"
              : "使用確定性備援"}
          </small>
        </div>
        <strong>{report.agent.summary}</strong>
      </section>

      <div className="report-grid">
        <div className="evidence-column">
          <section className="evidence-section" id="skills">
            <div className="section-heading">
              <div>
                <p className="eyebrow">PROGRAMMATIC COUNT</p>
                <h2>技能出現率</h2>
              </div>
              <span>同時顯示 n/N 與百分比</span>
            </div>
            <div className="skill-ledger">
              <div className="skill-header">
                <span>正規化技能</span>
                <span>本次樣本中的提及</span>
                <span>出現率</span>
                <span>公司覆蓋</span>
                <span>必備／加分</span>
              </div>
              {report.skillStats.slice(0, 12).map((skill) => (
                <div className="skill-row" key={skill.name}>
                  <strong>{skill.name}</strong>
                  <div className="skill-bar">
                    <i style={{ width: `${(skill.n / maxN) * 100}%` }} />
                  </div>
                  <b>
                    {skill.n}/{skill.N}
                    <small>{skill.percent}%</small>
                  </b>
                  <b>
                    {skill.companyN}/{skill.companyTotal}
                    <small>{skill.companyPercent}%</small>
                  </b>
                  <span>
                    {skill.requiredN}／{skill.preferredN}
                  </span>
                </div>
              ))}
              {!report.skillStats.length && (
                <p className="empty-copy">本次樣本尚未找到已設定的技能關鍵字。</p>
              )}
            </div>
          </section>

          <section className="evidence-section" id="community">
            <div className="section-heading">
              <div>
                <p className="eyebrow">COMMUNITY CALIBRATION</p>
                <h2>公開論壇訊號</h2>
              </div>
              <span>
                {communitySummary.count} 篇 · {communitySummary.sourceCount} 個來源 ·{" "}
                {communitySummary.firsthandCount} 篇疑似第一手 ·{" "}
                {communitySummary.thresholdMet ? "達證據門檻" : "證據不足"}
              </span>
            </div>
            <div className="community-list">
              {report.community.slice(0, 6).map((item, index) => (
                <article key={item.id}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <a href={item.url} target="_blank" rel="noreferrer">
                      {item.title}
                    </a>
                    <p>{item.snippet}</p>
                    <small>
                      {item.source}
                      {item.publishedAt ? ` · ${item.publishedAt}` : ""}
                      {item.firsthand ? " · 疑似第一手" : ""}
                    </small>
                  </div>
                </article>
              ))}
              {!report.community.length && (
                <p className="empty-copy">
                  本次沒有足夠的公開論壇證據，Agent 不會用搜尋摘要補成結論。
                </p>
              )}
            </div>
          </section>

          <section className="evidence-section" id="salary">
            <div className="section-heading">
              <div>
                <p className="eyebrow">COMPANY PAY CONTEXT</p>
                <h2>公司薪資資料</h2>
              </div>
              <span>上市櫃非主管薪資中位數</span>
            </div>
            <p className="section-intro">{report.salary.note}</p>
            {report.salary.matchedCompanies.map((company) => (
              <div className="salary-row" key={`${company.market}-${company.companyName}`}>
                <div>
                  <strong>{company.companyName}</strong>
                  <small>
                    {company.market === "listed" ? "上市" : "上櫃"} · 民國{" "}
                    {company.year} 年
                  </small>
                </div>
                <b>
                  {company.medianAnnualSalary
                    ? `約 ${company.medianAnnualSalary} 仟元／年`
                    : "未揭露中位數"}
                </b>
              </div>
            ))}
          </section>
        </div>

        <aside className="next-column">
          <section id="clusters">
            <div className="aside-heading">
              <div>
                <p className="eyebrow">INCLUDED CLUSTERS</p>
                <h2>職缺群組</h2>
              </div>
              <span>整類關閉後重算</span>
            </div>
            <div className="cluster-list">
              {report.clusters.map((cluster) => (
                <label key={cluster.id}>
                  <input
                    type="checkbox"
                    checked={cluster.included}
                    disabled={busy}
                    onChange={(event) =>
                      onToggleCluster(cluster.id, event.target.checked)
                    }
                  />
                  <span>
                    <strong>{cluster.name}</strong>
                    <small>{cluster.jobCount} 份</small>
                    <p>{cluster.reason}</p>
                    <em>{cluster.representativeTitles.join("、")}</em>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="recommendation-panel">
            <div className="aside-heading">
              <div>
                <p className="eyebrow">PREPARATION</p>
                <h2>準備順序</h2>
              </div>
            </div>
            <ol>
              {report.agent.recommendations.slice(0, 5).map((item) => (
                <li key={`${item.priority}-${item.title}`}>
                  <span>{item.priority}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.reason}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="source-panel">
            <div className="aside-heading">
              <div>
                <p className="eyebrow">SOURCE AUDIT</p>
                <h2>來源覆蓋</h2>
              </div>
            </div>
            <dl>
              {sourceEntries.map(([source, detail]) => (
                <div key={source}>
                  <dt>{sourceLabel(source)}</dt>
                  <dd>
                    {detail.count} · {sourceStatus(detail.status)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="limitations-panel">
            <div className="aside-heading">
              <div>
                <p className="eyebrow">LIMITATIONS</p>
                <h2>這份報告不能代表什麼</h2>
              </div>
            </div>
            <ul>
              {report.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <button
            className="primary-button resume-button"
            onClick={() => setResumeOpen(true)}
          >
            以這份分析準備履歷
          </button>
          <button
            className="report-problem"
            onClick={() => setProblemOpen(true)}
          >
            回報這份分析的問題
          </button>
        </aside>
      </div>
      {run.errorCode && (
        <p className="partial-footnote">
          部分階段未完成：{run.errorMessage}。已完成資料仍保留於本版報告。
        </p>
      )}
      {resumeOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card" role="dialog" aria-modal="true" aria-label="準備履歷">
            <button className="modal-close" onClick={() => setResumeOpen(false)} aria-label="關閉">
              ×
            </button>
            <p className="eyebrow">EVIDENCE-BASED RESUME</p>
            <h2>只用你確認過的事實寫履歷</h2>
            {!resumeDraft ? (
              <>
                <p>
                  現在才需要提供履歷資料。貼上既有履歷、專案說明與公開作品連結；
                  Agent 只會改寫其中有證據的內容，不會替你補造經歷。
                </p>
                <textarea
                  value={resumeSource}
                  onChange={(event) => setResumeSource(event.target.value)}
                  rows={12}
                  placeholder="貼上履歷、專案、學經歷、成果與 GitHub／作品集連結…"
                />
                <label className="file-pick">
                  讀取文字檔
                  <input
                    type="file"
                    accept=".txt,.md,.csv,.json,text/plain,text/markdown"
                    multiple
                    onChange={async (event) => {
                      const files = Array.from(event.target.files ?? []).slice(0, 100);
                      const text = await Promise.all(files.map((file) => file.text()));
                      setResumeSource((current) => [current, ...text].filter(Boolean).join("\n\n"));
                    }}
                  />
                </label>
                <div className="resume-options">
                  <label>
                    語言
                    <select
                      value={resumeLanguage}
                      onChange={(event) =>
                        setResumeLanguage(event.target.value === "en" ? "en" : "zh-TW")
                      }
                    >
                      <option value="zh-TW">繁體中文</option>
                      <option value="en">English</option>
                    </select>
                  </label>
                  <label className="confirm-source">
                    <input
                      type="checkbox"
                      checked={resumeConfirmed}
                      onChange={(event) => setResumeConfirmed(event.target.checked)}
                    />
                    我確認上述內容真實，並同意用於這份履歷。
                  </label>
                </div>
                {resumeError && <ErrorNotice message={resumeError} />}
                <button
                  className="primary-button"
                  onClick={generateResume}
                  disabled={!resumeConfirmed || resumeSource.trim().length < 20 || resumeBusy}
                >
                  {resumeBusy ? "履歷 Agent 撰寫中…" : "產生履歷草稿"}
                </button>
                <button
                  className="secondary-button"
                  onClick={deleteResumeData}
                  disabled={resumeBusy}
                >
                  {resumeBusy ? "處理中…" : "刪除求職姆姆中的全部履歷資料"}
                </button>
                <small className="modal-note">
                  MVP 可直接讀取 TXT、Markdown、CSV、JSON；PDF、DOCX 與圖片請先貼上可選取文字。
                </small>
              </>
            ) : (
              <ResumePreview
                draft={resumeDraft}
                onDownload={() => downloadResume(resumeDraft)}
                onRestart={() => setResumeDraft(null)}
                onDelete={deleteResumeData}
                deleteBusy={resumeBusy}
              />
            )}
          </section>
        </div>
      )}
      {problemOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card compact" role="dialog" aria-modal="true" aria-label="回報問題">
            <button className="modal-close" onClick={() => setProblemOpen(false)} aria-label="關閉">
              ×
            </button>
            <p className="eyebrow">QUALITY FEEDBACK</p>
            <h2>回報這份分析的問題</h2>
            <label>
              問題類型
              <select value={problemCategory} onChange={(event) => setProblemCategory(event.target.value)}>
                <option value="statistics">統計錯誤</option>
                <option value="clustering">分類錯誤</option>
                <option value="citation">引用錯誤</option>
                <option value="recommendation">建議不合理</option>
                <option value="resume">履歷捏造或遺漏</option>
                <option value="other">其他</option>
              </select>
            </label>
            <textarea
              rows={6}
              value={problemMessage}
              onChange={(event) => setProblemMessage(event.target.value)}
              placeholder="哪裡不對？正確情況是什麼？"
            />
            <button className="primary-button" onClick={submitProblem}>送出問題</button>
            {problemStatus && <p className="form-status">{problemStatus}</p>}
          </section>
        </div>
      )}
    </>
  );
}

function ResumePreview({
  draft,
  onDownload,
  onRestart,
  onDelete,
  deleteBusy,
}: {
  draft: ResumeDraft;
  onDownload: () => void;
  onRestart: () => void;
  onDelete: () => void;
  deleteBusy: boolean;
}) {
  return (
    <div className="resume-preview">
      <div className="resume-preview-actions">
        <button className="secondary-button" onClick={onRestart}>重寫來源</button>
        <button className="primary-button" onClick={onDownload}>下載 ATS 版 HTML</button>
        <button className="secondary-button" onClick={onDelete} disabled={deleteBusy}>
          {deleteBusy ? "刪除中…" : "刪除求職姆姆中的履歷資料"}
        </button>
      </div>
      <article>
        <h1>{draft.title}</h1>
        <p>{draft.summary}</p>
        {draft.skills.length > 0 && (
          <section><h2>技能</h2><p>{draft.skills.join(" · ")}</p></section>
        )}
        {draft.experience.length > 0 && (
          <section><h2>經歷</h2>{draft.experience.map((item) => (
            <div key={item.heading}><h3>{item.heading}</h3><ul>{item.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul></div>
          ))}</section>
        )}
        {draft.projects.length > 0 && (
          <section><h2>專案</h2>{draft.projects.map((item) => (
            <div key={item.heading}><h3>{item.heading}</h3><ul>{item.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul></div>
          ))}</section>
        )}
        {draft.education.length > 0 && (
          <section><h2>學歷</h2><ul>{draft.education.map((item) => <li key={item}>{item}</li>)}</ul></section>
        )}
        {draft.evidenceWarnings.length > 0 && (
          <aside><strong>需要補證據</strong><ul>{draft.evidenceWarnings.map((item) => <li key={item}>{item}</li>)}</ul></aside>
        )}
      </article>
    </div>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="error-notice" role="alert">
      <strong>目前無法完成這個動作</strong>
      <span>{message}</span>
    </div>
  );
}

function messageForError(error: unknown): string {
  const value = error instanceof Error ? error.message : "unknown_error";
  const messages: Record<string, string> = {
    authentication_required: "登入已失效，請重新登入。",
    invite_required: "這個帳號尚未受邀使用。",
    input_too_short: "請輸入至少兩個字。",
    no_matching_jobs:
      "本次公開資料掃描沒有找到相關職缺。你可以改貼一份明確 JD 進行分析。",
    jd_source_requires_user_paste:
      "此來源限制自動讀取，請貼上 JD 文字、PDF 或截圖。",
    monthly_paid_api_cap_reached:
      "本月付費 API 已達 25 美元上限；既有報告仍可查看。",
    paid_analysis_paused:
      "開發者目前暫停新的付費分析；既有報告仍可查看。",
    verified_resume_source_required:
      "請提供至少一段履歷事實，並確認內容真實且可用於履歷。",
    resume_generation_failed:
      "履歷 Agent 暫時無法完成草稿；已保留你的輸入，請稍後再試。",
    all_clusters_excluded: "至少保留一個職缺群組才能重新計算。",
  };
  return messages[value] ?? "系統已保留完成的資料，請稍後再試。";
}

function intentTypeLabel(type: IntentPreview["type"]) {
  if (type === "market") return "市場職缺分析";
  if (type === "single_jd_url") return "單一 JD 網址分析";
  return "單一 JD 文字分析";
}

function displayInitial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "使";
}

function projectStatus(status: string) {
  const labels: Record<string, string> = {
    draft: "待確認",
    analyzing: "分析中",
    complete: "分析完成",
    needs_attention: "需要處理",
  };
  return labels[status] ?? status;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-TW", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

function confidenceLabel(confidence: "high" | "medium" | "low") {
  return { high: "高", medium: "中", low: "低" }[confidence];
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    taiwan_jobs: "台灣就業通",
    user_jd: "使用者提供 JD",
    brave: "公開論壇",
  };
  return labels[source] ?? source;
}

function sourceStatus(status: string) {
  return {
    complete: "完成",
    not_used: "未使用",
    partial: "部分完成",
    unknown: "狀態未知",
  }[status] ?? status;
}

function downloadReport(report: ReportPayload) {
  downloadBlob(
    `求職姆姆-${safeFileName(report.targetRole)}-報告-v${report.reportVersion}.json`,
    JSON.stringify(report, null, 2),
    "application/json;charset=utf-8",
  );
}

function downloadResume(draft: ResumeDraft) {
  const sections = [
    `<h1>${escapeHtml(draft.title)}</h1>`,
    `<p>${escapeHtml(draft.summary)}</p>`,
    draft.skills.length
      ? `<h2>技能</h2><p>${draft.skills.map(escapeHtml).join(" · ")}</p>`
      : "",
    ...draft.experience.map(
      (item) =>
        `<h2>${escapeHtml(item.heading)}</h2><ul>${item.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>`,
    ),
    ...draft.projects.map(
      (item) =>
        `<h2>${escapeHtml(item.heading)}</h2><ul>${item.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>`,
    ),
    draft.education.length
      ? `<h2>學歷</h2><ul>${draft.education.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : "",
  ].join("\n");
  const html = `<!doctype html><html lang="${draft.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(draft.title)}</title><style>body{font:15px/1.55 Arial,"Noto Sans TC",sans-serif;color:#17201d;max-width:760px;margin:40px auto;padding:0 28px}h1{font-size:30px;border-bottom:2px solid #17201d;padding-bottom:10px}h2{font-size:17px;margin:25px 0 8px;text-transform:uppercase;letter-spacing:.04em}ul{padding-left:22px}li{margin:5px 0}@media print{body{margin:0;max-width:none}}</style></head><body>${sections}</body></html>`;
  downloadBlob(
    `求職姆姆-${safeFileName(draft.title)}-ATS履歷.html`,
    html,
    "text/html;charset=utf-8",
  );
}

function downloadBlob(fileName: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ] ?? character,
  );
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").slice(0, 60) || "文件";
}
