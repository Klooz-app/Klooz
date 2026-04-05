import React, { createContext, useContext, useEffect, useState } from "react";
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  ChevronRight,
  Compass,
  History,
  Menu,
  Sparkles,
  User,
  Wallet,
  X,
} from "lucide-react";

const STORAGE_KEYS = {
  session: "klooz_session",
  history: "klooz_history",
  latest_result: "klooz_latest_result",
  usage: "klooz_usage",
};

const FREE_LIMIT = 5; // per day

const DEFAULT_RESULT = {
  summary: "Run a prompt to see your AI result here.",
  paths: [
    {
      title: "Path 1 · Move now",
      tone: "Faster shift, stronger pressure",
      bullets: [
        "You get emotional relief sooner.",
        "The trade-off is less stability while adjusting.",
        "Works best when your current situation is already unsustainable.",
      ],
    },
    {
      title: "Path 2 · Ease into it",
      tone: "Steadier pace, lower stress",
      bullets: [
        "You protect more stability while testing the change.",
        "The trade-off is slower momentum.",
        "Usually the lower-regret choice when you need time to adjust.",
      ],
    },
  ],
  verdict:
    "A gradual move is usually the calmer recommendation when you want change without unnecessary pressure.",
  nextSteps: [
    "Write down the real reason you want this change.",
    "List what support or savings each path needs.",
    "Try the lower-regret option for the next 2 to 4 weeks.",
  ],
  shareCard: "Klooz says the lower-pressure path is likely the stronger move right now.",
};

const KLOOZ_VOICE = {
  principles: [
    "Be calm, practical, and specific.",
    "Avoid hype, therapy language, and vague motivation.",
    "Do not sound childish or overly corporate.",
    "Explain trade-offs clearly.",
    "Prefer realistic next steps over abstract advice.",
  ],
};

function sanitizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildDecisionPrompt({ prompt, session }) {
  const userName = sanitizeText(session?.name) || "the user";
  return {
    mode: "decision",
    userContext: {
      name: userName,
      audience: "13+ broad audience",
    },
    instructions: [
      ...KLOOZ_VOICE.principles,
      "Return exactly 2 realistic paths, not more.",
      "Each path should feel different in pace, pressure, and trade-off.",
      "Verdict should recommend the calmer stronger option, unless a bolder move is clearly better.",
      "Next steps must be concrete and immediately usable.",
      "Do not repeat the user's words back too much.",
    ],
    input: {
      decision: sanitizeText(prompt),
    },
  };
}

function buildMoneyPrompt({ energy, time, workStyle, skills, session }) {
  const userName = sanitizeText(session?.name) || "the user";
  return {
    mode: "money",
    userContext: {
      name: userName,
      audience: "13+ broad audience",
    },
    instructions: [
      ...KLOOZ_VOICE.principles,
      "Return exactly 2 strongest paths for consistency with the UI.",
      "Focus on realistic work or income options, not fantasy side hustles.",
      "Match the answer to the user's energy, time, and work style.",
      "If skills are unclear, make grounded assumptions and keep options beginner-friendly.",
      "Verdict should say which path is most realistic right now and why.",
    ],
    input: {
      energy: sanitizeText(energy),
      time: sanitizeText(time),
      workStyle: sanitizeText(workStyle),
      skills: sanitizeText(skills),
    },
  };
}

function buildParallelPrompt({ prompt, horizon, session }) {
  const userName = sanitizeText(session?.name) || "the user";
  return {
    mode: "parallel",
    userContext: {
      name: userName,
      audience: "13+ broad audience",
    },
    instructions: [
      ...KLOOZ_VOICE.principles,
      "Return exactly 3 paths titled Stay, Change, and Balanced.",
      "Each path must include a distinct short description.",
      "Stats must be believable and internally consistent.",
      "Higher growth should usually come with either lower stability or higher risk.",
      "Keep the tone grounded, not dramatic.",
    ],
    input: {
      decision: sanitizeText(prompt),
      horizon: sanitizeText(horizon),
    },
  };
}

async function fetchKloozAI(payload) {
  const response = await fetch("/api/klooz", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Could not reach Klooz AI");
  }

  return response.json();
}

function normalizeDecisionResult(data) {
  return {
    summary: data?.summary || DEFAULT_RESULT.summary,
    paths: Array.isArray(data?.paths) && data.paths.length ? data.paths : DEFAULT_RESULT.paths,
    verdict: data?.verdict || DEFAULT_RESULT.verdict,
    nextSteps: Array.isArray(data?.nextSteps) && data.nextSteps.length ? data.nextSteps : DEFAULT_RESULT.nextSteps,
    shareCard: data?.shareCard || DEFAULT_RESULT.shareCard,
  };
}

function normalizeParallelResult(data) {
  return {
    summary: data?.summary || "Klooz compared three possible futures for your decision.",
    paths:
      Array.isArray(data?.paths) && data.paths.length
        ? data.paths
        : [
            { title: "Stay", desc: "Stable, slower growth, less disruption.", stats: { stability: 80, risk: 20, growth: 30 } },
            { title: "Change", desc: "Uncertain start, higher upside over time.", stats: { stability: 35, risk: 75, growth: 80 } },
            { title: "Balanced", desc: "Moderate pace, lower regret, more control.", stats: { stability: 68, risk: 38, growth: 60 } },
          ],
  };
}

const KloozContext = createContext(null);
const useKlooz = () => useContext(KloozContext);

const pageVariants = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -18 },
};

const cardHover = {
  rest: { y: 0, scale: 1 },
  hover: { y: -4, scale: 1.01 },
};

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function KloozProvider({ children }) {
  const [session, setSession] = useState(null);
  const [history, setHistory] = useState([]);
  const [latestResult, setLatestResult] = useState(load(STORAGE_KEYS.latest_result, DEFAULT_RESULT));
  const [parallelResult, setParallelResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [parallelLoading, setParallelLoading] = useState(false);
  const [usage, setUsage] = useState(load(STORAGE_KEYS.usage, { count: 0, date: new Date().toDateString() }));

  useEffect(() => {
    setSession(load(STORAGE_KEYS.session, null));
    setHistory(load(STORAGE_KEYS.history, []));
    setLatestResult(load(STORAGE_KEYS.latest_result, DEFAULT_RESULT));

    const savedUsage = load(STORAGE_KEYS.usage, { count: 0, date: new Date().toDateString() });
    if (savedUsage.date !== new Date().toDateString()) {
      setUsage({ count: 0, date: new Date().toDateString() });
    } else {
      setUsage(savedUsage);
    }
  }, []);

  useEffect(() => {
    save(STORAGE_KEYS.history, history);
  }, [history]);

  useEffect(() => {
    save(STORAGE_KEYS.usage, usage);
  }, [usage]);

  useEffect(() => {
    save(STORAGE_KEYS.latest_result, latestResult);
  }, [latestResult]);

  const handleLogin = (name) => {
    const clean = name.trim();
    if (!clean) return;
    const next = { name: clean };
    setSession(next);
    save(STORAGE_KEYS.session, next);
  };

  const pushHistory = (entry) => {
    setHistory((prev) => [entry, ...prev].slice(0, 20));
  };

  const canRun = () => {
    if (usage.count >= FREE_LIMIT) {
      alert("Free limit reached. Upgrade to premium.");
      return false;
    }
    return true;
  };

  const incrementUsage = () => {
    setUsage((prev) => ({ ...prev, count: prev.count + 1 }));
  };

  const runDecisionAI = async ({ prompt }) => {
    if (!canRun()) return;
    setLoading(true);
    incrementUsage();
    try {
      const data = await fetchKloozAI(buildDecisionPrompt({ prompt, session }));
      const normalized = normalizeDecisionResult(data);
      setLatestResult(normalized);
      pushHistory({ id: crypto.randomUUID(), type: "Decision", title: prompt || "Decision", createdAt: new Date().toLocaleString(), summary: normalized.summary, result: normalized });
      return normalized;
    } catch {
      setLatestResult(DEFAULT_RESULT);
      return DEFAULT_RESULT;
    } finally {
      setLoading(false);
    }
  };

  const runMoneyAI = async ({ energy, time, workStyle, skills }) => {
    if (!canRun()) return;
    setLoading(true);
    incrementUsage();
    try {
      const data = await fetchKloozAI(buildMoneyPrompt({ energy, time, workStyle, skills, session }));
      const normalized = normalizeDecisionResult(data);
      setLatestResult(normalized);
      pushHistory({ id: crypto.randomUUID(), type: "Money", title: skills || "Money paths", createdAt: new Date().toLocaleString(), summary: normalized.summary, result: normalized });
      return normalized;
    } catch {
      setLatestResult(DEFAULT_RESULT);
      return DEFAULT_RESULT;
    } finally {
      setLoading(false);
    }
  };

  const runParallelAI = async ({ prompt, horizon }) => {
    if (!canRun()) return;
    setParallelLoading(true);
    incrementUsage();
    try {
      const data = await fetchKloozAI(buildParallelPrompt({ prompt, horizon, session }));
      const normalized = normalizeParallelResult(data);
      setParallelResult(normalized);
      pushHistory({ id: crypto.randomUUID(), type: "Parallel", title: prompt || "Parallel You", createdAt: new Date().toLocaleString(), summary: normalized.summary, result: normalized });
      return normalized;
    } catch {
      const fallback = normalizeParallelResult(null);
      setParallelResult(fallback);
      return fallback;
    } finally {
      setParallelLoading(false);
    }
  };

  return (
    <KloozContext.Provider
      value={{
        usage,
        remaining: Math.max(0, FREE_LIMIT - usage.count),
        session,
        history,
        setHistory,
        handleLogin,
        latestResult,
        parallelResult,
        loading,
        parallelLoading,
        runDecisionAI,
        runMoneyAI,
        runParallelAI,
        setLatestResult,
      }}
    >
      {children}
    </KloozContext.Provider>
  );
}

function Button({ children, primary, className = "", ...props }) {
  return (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-medium transition-all duration-200 ${
        primary
          ? "bg-[#5B4DF6] text-white shadow-[0_10px_30px_rgba(91,77,246,0.28)] hover:bg-[#4F42E0]"
          : "border border-slate-200 bg-white/90 text-slate-800 hover:bg-slate-50"
      } ${className}`}
      {...props}
    >
      {children}
    </motion.button>
  );
}

function GlassCard({ children, className = "" }) {
  return (
    <div className={`rounded-[28px] border border-white/60 bg-white/72 backdrop-blur-xl shadow-[0_12px_40px_rgba(15,23,42,0.08)] ${className}`}>
      {children}
    </div>
  );
}

function SectionIntro({ eyebrow, title, body }) {
  return (
    <div className="max-w-2xl">
      {eyebrow ? (
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#DCD7FF] bg-[#F4F2FF] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[#5B4DF6]">
          <Sparkles className="h-3.5 w-3.5" />
          {eyebrow}
        </div>
      ) : null}
      <h2 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{title}</h2>
      {body ? <p className="mt-3 text-[15px] leading-7 text-slate-600">{body}</p> : null}
    </div>
  );
}

function Navbar() {
  const { session, remaining, usage } = useKlooz();
  const [open, setOpen] = useState(false);
  const nav = [
    ["/decision", "Decision"],
    ["/money", "Money"],
    ["/parallel", "Parallel"],
    ["/history", "History"],
  ];

  return (
    <div className="sticky top-4 z-40 pt-4">
      <GlassCard className="px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[#5B4DF6] to-[#8A7BFF] text-white shadow-[0_8px_25px_rgba(91,77,246,0.28)]">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-[0.22em] text-slate-500">KLOOZ</div>
              <div className="text-sm text-slate-600">Clearer choices, calmer moves.</div>
            </div>
          </Link>

          <div className="hidden items-center gap-2 md:flex">
            {nav.map(([to, label]) => (
              <Link key={to} to={to} className="rounded-2xl px-4 py-2.5 text-sm text-slate-700 transition hover:bg-slate-100">
                {label}
              </Link>
            ))}
          </div>

          <div className="hidden items-center gap-3 md:flex">
            <div className="rounded-2xl border border-[#DCD7FF] bg-[#F4F2FF] px-3 py-2 text-xs font-medium text-[#5B4DF6]">
              {remaining > 0 ? `${remaining} free runs left today` : "Free limit reached"}
            </div>
            {session ? (
              <Link to="/login" className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700">
                {session.name}
              </Link>
            ) : (
              <Link to="/login"><Button primary>Login</Button></Link>
            )}
            <Link to="/pricing"><Button className="border-[#CFC7FF] bg-[#FBFAFF] text-[#5B4DF6] hover:bg-[#F4F2FF]">Upgrade</Button></Link>
          </div>

          <button onClick={() => setOpen((v) => !v)} className="rounded-2xl p-2 text-slate-700 md:hidden">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </GlassCard>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mt-3 md:hidden"
          >
            <GlassCard className="p-3">
              <div className="space-y-1">
                {[...nav, ["/pricing", "Upgrade"], ["/login", session ? session.name : "Login"]].map(([to, label]) => (
                  <Link key={to} to={to} onClick={() => setOpen(false)} className="flex items-center justify-between rounded-2xl px-3 py-3 text-sm text-slate-700 hover:bg-slate-50">
                    <span>{label}</span>
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function HeroOrb({ className = "" }) {
  return <div className={`absolute rounded-full blur-3xl ${className}`} />;
}

function Hero() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="relative overflow-hidden rounded-[36px] border border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(146,129,255,0.35),_transparent_28%),linear-gradient(135deg,_#181A33_0%,_#23285A_52%,_#4F46E5_100%)] px-6 py-8 text-white shadow-[0_20px_60px_rgba(43,34,115,0.35)] sm:px-10 sm:py-12"
    >
      <HeroOrb className="-left-8 top-0 h-44 w-44 bg-[#8A7BFF]/40" />
      <HeroOrb className="right-0 top-10 h-56 w-56 bg-[#4FE3FF]/20" />
      <HeroOrb className="bottom-0 right-20 h-40 w-40 bg-[#9F8CFF]/30" />

      <div className="relative grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-white/90">
            <Compass className="h-3.5 w-3.5" />
            Decision clarity, redesigned
          </div>
          <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl lg:text-[3.5rem]">
            Stop guessing. <span className="text-white/80">See your options.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-8 text-white/78 sm:text-lg">
            Klooz helps you understand your decisions clearly before you act, with a calmer experience that feels polished, modern, and easy to use.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/decision"><Button primary className="border-0">Try Decision <ArrowRight className="h-4 w-4" /></Button></Link>
            <Link to="/money"><Button className="bg-white/12 text-white border-white/15 hover:bg-white/18">Find Money Paths</Button></Link>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.15, duration: 0.45 }}
          className="relative"
        >
          <div className="absolute inset-0 rounded-[28px] bg-white/10 blur-2xl" />
          <div className="relative rounded-[28px] border border-white/15 bg-white/10 p-4 backdrop-blur-md">
            <div className="mb-3 flex items-center gap-2 text-sm text-white/80">
              <div className="h-2.5 w-2.5 rounded-full bg-[#7CFFB2]" />
              Parallel path preview
            </div>
            <div className="space-y-3">
              {[
                ["Move now", "Faster change, more pressure early on."],
                ["Ease into it", "Steadier confidence, lower pressure."],
                ["Blend both", "More balance, slower but safer momentum."],
              ].map(([title, text], i) => (
                <motion.div
                  key={title}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 + i * 0.08 }}
                  className="rounded-2xl border border-white/10 bg-white/10 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-white">{title}</div>
                    <div className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/70">Path {i + 1}</div>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-white/72">{text}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </motion.section>
  );
}

function FeatureCard({ icon: Icon, title, text }) {
  return (
    <motion.div variants={cardHover} initial="rest" whileHover="hover" className="h-full">
      <GlassCard className="h-full p-5">
        <div className="mb-4 inline-flex rounded-2xl bg-[#F3F1FF] p-3 text-[#5B4DF6]">
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="text-base font-semibold text-slate-950">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
      </GlassCard>
    </motion.div>
  );
}

function ExampleCard() {
  return (
    <GlassCard className="p-6 sm:p-7">
      <SectionIntro
        eyebrow="Example"
        title="A clearer result format"
        body="Instead of a giant answer block, Klooz turns responses into paths you can compare fast."
      />
      <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50/80 p-4 text-sm leading-7 text-slate-600">
        “Should I quit my job?”
      </div>
      <div className="mt-4 grid gap-3">
        <motion.div whileHover={{ x: 2 }} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="font-medium text-slate-950">Quit now</div>
          <div className="mt-1 text-sm leading-6 text-slate-600">Fast change, more pressure, stronger emotional swing.</div>
        </motion.div>
        <motion.div whileHover={{ x: 2 }} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="font-medium text-slate-950">Transition slowly</div>
          <div className="mt-1 text-sm leading-6 text-slate-600">Slower progress, more stability, lower pressure.</div>
        </motion.div>
      </div>
    </GlassCard>
  );
}

function PageWrap({ children }) {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

function UsageBanner() {
  const { remaining, usage } = useKlooz();

  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-950">Free plan usage</div>
          <div className="mt-1 text-sm leading-6 text-slate-600">
            {remaining > 0
              ? `You have ${remaining} of ${FREE_LIMIT} free AI runs left today.`
              : `You have used all ${FREE_LIMIT} free AI runs for today.`}
          </div>
        </div>
        <div className="flex gap-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Used today: {usage.count}
          </div>
          <Link to="/pricing"><Button primary>Upgrade to Pro</Button></Link>
        </div>
      </div>
    </GlassCard>
  );
}

function HomePage() {
  return (
    <PageWrap>
      <div className="space-y-10 pb-8">
        <Hero />
        <UsageBanner />

        <section className="grid gap-4 md:grid-cols-3">
          <FeatureCard icon={Compass} title="Make a decision" text="Compare choices without turning the experience into a complicated dashboard." />
          <FeatureCard icon={Wallet} title="Find ways to earn" text="Get grounded ideas that feel more realistic than generic hype." />
          <FeatureCard icon={Sparkles} title="Explore outcomes" text="See paths side by side so the next step feels clearer and calmer." />
        </section>

        <GlassCard className="p-6 sm:p-7">
          <SectionIntro eyebrow="Signature feature" title="Parallel You" body="See how your future could look based on different choices." />
          <div className="mt-6">
            <Link to="/parallel"><Button primary>Try Parallel You</Button></Link>
          </div>
        </GlassCard>

        <ExampleCard />
      </div>
    </PageWrap>
  );
}

function ResultPreview() {
  const { latestResult, loading } = useKlooz();
  const result = latestResult || DEFAULT_RESULT;

  return (
    <GlassCard className="p-6 sm:p-8">
      <SectionIntro
        eyebrow="Results"
        title="A clearer, more premium result flow"
        body="Results now feel like a real product feature instead of placeholder cards."
      />

      <div className="mt-6 space-y-4">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-[28px] border border-[#E7E1FF] bg-[linear-gradient(180deg,_#F7F4FF_0%,_#F3F5FF_100%)] p-5"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5B4DF6]">Klooz summary</div>
            {loading ? <div className="text-xs text-slate-500">Thinking...</div> : null}
          </div>
          <p className="text-sm leading-7 text-slate-700">{result.summary}</p>
        </motion.div>

        <div className="grid gap-4 xl:grid-cols-2">
          {(result.paths || []).slice(0, 2).map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + i * 0.08 }}
              whileHover={{ y: -3 }}
              className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-slate-950">{item.title}</div>
                  <div className="mt-1 text-sm text-slate-500">{item.tone}</div>
                </div>
                <div className="rounded-full bg-[#F3F1FF] px-3 py-1 text-xs font-medium text-[#5B4DF6]">Compare</div>
              </div>
              <div className="mt-4 space-y-2.5">
                {(item.bullets || []).map((bullet) => (
                  <div key={bullet} className="flex items-start gap-3 rounded-2xl bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-700">
                    <div className="mt-2 h-2 w-2 rounded-full bg-[#5B4DF6]" />
                    <span>{bullet}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <motion.div whileHover={{ y: -2 }} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Klooz verdict</div>
            <p className="text-sm leading-7 text-slate-700">{result.verdict}</p>
          </motion.div>

          <motion.div whileHover={{ y: -2 }} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Next steps</div>
            <div className="space-y-3">
              {(result.nextSteps || []).map((step, index) => (
                <div key={step} className="flex items-start gap-3 text-sm leading-6 text-slate-700">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F3F1FF] text-xs font-semibold text-[#5B4DF6]">
                    {index + 1}
                  </div>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        <div className="flex flex-wrap gap-3 pt-1">
          <Button>Save result</Button>
          <Button>Copy summary</Button>
          <Button primary>Share card</Button>
        </div>
      </div>
    </GlassCard>
  );
}

function UpgradeCard() {
  const { remaining } = useKlooz();

  return (
    <GlassCard className="p-5 sm:p-6">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#5B4DF6]">Klooz Pro</div>
      <h3 className="text-lg font-semibold text-slate-950">Unlock unlimited runs</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Stay in flow with unlimited AI runs, deeper future comparisons, and premium insights as Klooz grows.
      </p>
      <div className="mt-4 rounded-2xl bg-[#F6F4FF] px-4 py-3 text-sm text-slate-700">
        {remaining > 0 ? `${remaining} free runs left today` : "You’ve reached today’s free limit."}
      </div>
      <div className="mt-4">
        <Link to="/pricing"><Button primary className="w-full">Upgrade to Pro</Button></Link>
      </div>
    </GlassCard>
  );
}

function ToolShell({ title, body, children, cta }) {
  return (
    <PageWrap>
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <GlassCard className="p-6 sm:p-8">
            <SectionIntro eyebrow="Tool" title={title} body={body} />
            <div className="mt-6 space-y-4">{children}</div>
            <div className="mt-5">{cta}</div>
          </GlassCard>

          <UpgradeCard />
        </div>

        <ResultPreview />
      </div>
    </PageWrap>
  );
}

function DecisionPage() {
  const { runDecisionAI, loading } = useKlooz();
  const [prompt, setPrompt] = useState("");

  return (
    <ToolShell
      title="Decision Tool"
      body="Type the choice you are weighing and Klooz will help compare realistic directions."
      cta={<Button primary onClick={() => runDecisionAI({ prompt })}>{loading ? "Thinking..." : "Run"}</Button>}
    >
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        className="min-h-[180px] w-full rounded-3xl border border-slate-200 bg-white px-4 py-4 text-sm leading-7 text-slate-800 outline-none transition focus:border-[#5B4DF6]"
        placeholder="Your decision..."
      />
    </ToolShell>
  );
}

function MoneyPage() {
  const { runMoneyAI, loading } = useKlooz();
  const [form, setForm] = useState({ energy: "", time: "", workStyle: "", skills: "" });

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <ToolShell
      title="Money Paths"
      body="Start with your current situation and Klooz will help surface realistic options."
      cta={<Button primary onClick={() => runMoneyAI(form)}>{loading ? "Thinking..." : "Generate"}</Button>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <input value={form.energy} onChange={(e) => update("energy", e.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#5B4DF6]" placeholder="Energy level" />
        <input value={form.time} onChange={(e) => update("time", e.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#5B4DF6]" placeholder="Time available" />
        <input value={form.workStyle} onChange={(e) => update("workStyle", e.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#5B4DF6]" placeholder="Work style" />
        <input value={form.skills} onChange={(e) => update("skills", e.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#5B4DF6]" placeholder="Skills or strengths" />
      </div>
    </ToolShell>
  );
}

function Meter({ label, value }) {
  return (
    <div>
      <div className="mb-1 text-xs text-slate-500">{label}</div>
      <div className="h-2 w-full rounded-full bg-slate-200">
        <div
          className="h-2 rounded-full bg-[#5B4DF6]"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function PathCard({ title, desc, stats, delay }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      whileHover={{ y: -4 }}
      className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="text-xs font-semibold text-slate-500">Path</div>
      <div className="mt-1 text-base font-semibold text-slate-950">{title}</div>
      <p className="mt-2 text-sm text-slate-600 leading-6">{desc}</p>
      <div className="mt-4 space-y-2">
        <Meter label="Stability" value={stats.stability} />
        <Meter label="Risk" value={stats.risk} />
        <Meter label="Growth" value={stats.growth} />
      </div>
    </motion.div>
  );
}

function ParallelPage() {
  const { runParallelAI, parallelResult, parallelLoading } = useKlooz();
  const [input, setInput] = useState("");
  const [horizon, setHorizon] = useState("3 months");

  const fallbackPaths = [
    { title: "Stay", desc: "Stable, slower growth, less disruption.", stats: { stability: 80, risk: 20, growth: 30 } },
    { title: "Change", desc: "Uncertain start, higher upside over time.", stats: { stability: 35, risk: 75, growth: 80 } },
    { title: "Balanced", desc: "Moderate pace, lower regret, more control.", stats: { stability: 68, risk: 38, growth: 60 } },
  ];

  const paths = parallelResult?.paths || fallbackPaths;

  return (
    <PageWrap>
      <div className="space-y-6">
        <GlassCard className="p-6 sm:p-8">
          <SectionIntro
            eyebrow="Parallel You"
            title="Compare your possible futures"
            body="Enter a decision and see how each path evolves over time."
          />

          <div className="mt-6 space-y-4">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Example: Should I quit my job and start fresh?"
              className="min-h-[140px] w-full rounded-3xl border border-slate-200 px-4 py-4 text-sm outline-none focus:border-[#5B4DF6]"
            />

            <div className="flex flex-wrap items-center gap-2">
              {["3 months", "6 months", "1 year"].map((t) => (
                <button
                  key={t}
                  onClick={() => setHorizon(t)}
                  className={`rounded-full px-4 py-2 text-xs font-medium transition ${
                    horizon === t
                      ? "bg-[#5B4DF6] text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <Button primary onClick={() => runParallelAI({ prompt: input, horizon })}>{parallelLoading ? "Thinking..." : "Generate Paths"}</Button>
          </div>
        </GlassCard>

        {parallelResult?.summary ? (
          <GlassCard className="p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5B4DF6]">Parallel summary</div>
            <p className="mt-2 text-sm leading-7 text-slate-700">{parallelResult.summary}</p>
          </GlassCard>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          {paths.map((item, i) => (
            <PathCard
              key={item.title}
              title={item.title}
              desc={item.desc}
              stats={item.stats}
              delay={0.1 + i * 0.1}
            />
          ))}
        </div>
      </div>
    </PageWrap>
  );
}

function HistoryPage() {
  const { history, setLatestResult } = useKlooz();
  const navigate = useNavigate();

  return (
    <PageWrap>
      <GlassCard className="p-6 sm:p-8">
        <SectionIntro eyebrow="History" title="Saved results" body="This section will hold past runs in a cleaner, more visual list." />
        <div className="mt-6 space-y-3">
          {history.length ? (
            history.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  if (item.type !== "Parallel") setLatestResult(item.result);
                  navigate(item.type === "Money" ? "/money" : item.type === "Parallel" ? "/parallel" : "/decision");
                }}
                className="w-full rounded-3xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{item.type}</div>
                    <div className="mt-1 text-sm text-slate-600">{item.summary}</div>
                  </div>
                  <div className="text-xs text-slate-400">{item.createdAt}</div>
                </div>
              </button>
            ))
          ) : (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 p-8 text-center text-sm text-slate-500">
              No saved results yet.
            </div>
          )}
        </div>
      </GlassCard>
    </PageWrap>
  );
}

function PricingPage() {
  return (
    <PageWrap>
      <div className="grid gap-6 lg:grid-cols-2">
        <GlassCard className="p-6 sm:p-8">
          <SectionIntro eyebrow="Pricing" title="Simple plans that make sense" body="Start free, then upgrade when Klooz becomes part of your regular decision process." />
          <div className="mt-6 space-y-4">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm font-semibold text-slate-950">Free</div>
              <div className="mt-1 text-3xl font-semibold text-slate-950">$0</div>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <div>• 5 AI runs per day</div>
                <div>• Decision, Money, and Parallel tools</div>
                <div>• Saved local history</div>
              </div>
            </div>

            <div className="rounded-[28px] border border-[#D8D2FF] bg-[linear-gradient(180deg,_#FCFBFF_0%,_#F5F2FF_100%)] p-5 shadow-sm">
              <div className="inline-flex rounded-full bg-[#5B4DF6] px-3 py-1 text-xs font-semibold text-white">Recommended</div>
              <div className="mt-3 text-sm font-semibold text-slate-950">Klooz Pro</div>
              <div className="mt-1 text-3xl font-semibold text-slate-950">
                $9<span className="text-base text-slate-500">/mo</span>
              </div>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <div>• Unlimited AI runs</div>
                <div>• Priority comparisons</div>
                <div>• Premium insights</div>
              </div>
              <div className="mt-5">
                <Button primary className="w-full">Upgrade to Pro</Button>
              </div>
            </div>
          </div>
        </GlassCard>
      </div>
    </PageWrap>
  );
}

function LoginPage() {
  const { handleLogin } = useKlooz();
  const navigate = useNavigate();
  const [name, setName] = useState("");

  return (
    <PageWrap>
      <div className="mx-auto max-w-lg">
        <GlassCard className="p-6 sm:p-8">
          <SectionIntro eyebrow="Login" title="Start your Klooz session" body="Simple sign-in." />
          <div className="mt-6 space-y-4">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className="w-full rounded-3xl border border-slate-200 px-4 py-4 text-sm"
            />
            <Button
              primary
              onClick={() => {
                handleLogin(name);
                navigate("/");
              }}
              className="w-full"
            >
              Continue
            </Button>
          </div>
        </GlassCard>
      </div>
    </PageWrap>
  );
}

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<HomePage />} />
        <Route path="/decision" element={<DecisionPage />} />
        <Route path="/money" element={<MoneyPage />} />
        <Route path="/parallel" element={<ParallelPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/pricing" element={<PricingPage />} />
      </Routes>
    </AnimatePresence>
  );
}

function Layout() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(122,102,255,0.14),_transparent_28%),linear-gradient(180deg,_#F5F4FF_0%,_#F7F8FC_42%,_#F4F6FA_100%)]">
      <div className="mx-auto max-w-6xl px-4 pb-14 sm:px-6 lg:px-8">
        <Navbar />
        <div className="pt-6">
          <AnimatedRoutes />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <KloozProvider>
        <Layout />
      </KloozProvider>
    </BrowserRouter>
  );
}
