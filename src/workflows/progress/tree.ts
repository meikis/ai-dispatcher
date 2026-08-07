// progress/tree.ts — render ProgressEvents as a terminal live tree
// progress/tree.ts —— 把 ProgressEvent 渲染成终端中的实时树

import type { ProgressEvent, EventSink } from "../types.js";

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const DIM = `${ESC}2m`;
const BOLD = `${ESC}1m`;
const GREEN = `${ESC}32m`;
const RED = `${ESC}31m`;
const CYAN = `${ESC}36m`;
const YELLOW = `${ESC}33m`;
const GLYPH_RUNNING = "⟳";
const GLYPH_DONE = "✓";
const GLYPH_FAILED = "✗";
const GLYPH_SKIPPED = "⊘";

type AgentStatus = "running" | "done" | "failed" | "skipped";

interface AgentRow {
  agentId: number;
  label: string;
  status: AgentStatus;
  cached: boolean;
  costUsd: number;
  outputTokens: number;
  durationMs: number;
  error?: string;
}

interface PhaseGroup {
  title: string;
  agents: AgentRow[];
}

const UNGROUPED_KEY = " ungrouped";
const UNGROUPED_TITLE = "ungrouped";

export function createTreeRenderer(out: EventSink): EventSink {
  const phases = new Map<string, PhaseGroup>();
  const rows = new Map<number, AgentRow>();
  let currentPhase: string | null = null;

  function render() {
    const lines: string[] = [];
    for (const [key, group] of phases) {
      if (key === UNGROUPED_KEY) continue;
      lines.push(`${BOLD}${CYAN}${group.title}${RESET}`);
      for (const agent of group.agents) {
        let glyph = GLYPH_RUNNING;
        let color = DIM;
        if (agent.status === "done") { glyph = GLYPH_DONE; color = GREEN; }
        if (agent.status === "failed") { glyph = GLYPH_FAILED; color = RED; }
        if (agent.status === "skipped") { glyph = GLYPH_SKIPPED; color = YELLOW; }
        const costStr = agent.costUsd > 0 ? ` $${agent.costUsd.toFixed(2)}` : "";
        const durStr = agent.durationMs > 0 ? ` ${agent.durationMs}ms` : "";
        const cacheTag = agent.cached ? " (cached)" : "";
        lines.push(`  ${color}${glyph}${RESET} ${agent.label}${costStr}${durStr}${cacheTag}`);
      }
    }
    const ungrouped = phases.get(UNGROUPED_KEY);
    if (ungrouped && ungrouped.agents.length > 0) {
      lines.push(`${BOLD}${CYAN}${UNGROUPED_TITLE}${RESET}`);
      for (const agent of ungrouped.agents) {
        let glyph = GLYPH_RUNNING;
        let color = DIM;
        if (agent.status === "done") { glyph = GLYPH_DONE; color = GREEN; }
        if (agent.status === "failed") { glyph = GLYPH_FAILED; color = RED; }
        if (agent.status === "skipped") { glyph = GLYPH_SKIPPED; color = YELLOW; }
        const costStr = agent.costUsd > 0 ? ` $${agent.costUsd.toFixed(2)}` : "";
        lines.push(`  ${color}${glyph}${RESET} ${agent.label}${costStr}`);
      }
    }
    out({ type: "log", text: lines.join("\n") });
  }

  return (event: ProgressEvent) => {
    if (event.type === "phase_start" && event.phaseTitle) {
      currentPhase = event.phaseTitle;
      if (!phases.has(event.phaseTitle)) {
        phases.set(event.phaseTitle, { title: event.phaseTitle, agents: [] });
      }
      render();
    } else if (event.type === "agent_start" && event.agentId !== undefined) {
      const phaseKey = currentPhase ?? UNGROUPED_KEY;
      let group = phases.get(phaseKey);
      if (!group) {
        group = { title: currentPhase ?? UNGROUPED_TITLE, agents: [] };
        phases.set(phaseKey, group);
      }
      const row: AgentRow = {
        agentId: event.agentId,
        label: event.label ?? `agent-${event.agentId}`,
        status: "running",
        cached: false,
        costUsd: 0,
        outputTokens: 0,
        durationMs: 0,
      };
      rows.set(event.agentId, row);
      group.agents.push(row);
      render();
    } else if (event.type === "agent_end" && event.agentId !== undefined) {
      const row = rows.get(event.agentId);
      if (row) {
        if (event.error) {
          row.status = "failed";
          row.error = event.error;
        } else if (event.cached) {
          row.status = "skipped";
          row.cached = true;
        } else {
          row.status = "done";
        }
        if (event.costUsd) row.costUsd = event.costUsd;
        if (event.durationMs) row.durationMs = event.durationMs;
      }
      render();
    } else if (event.type === "log") {
      out(event);
    }
  };
}
