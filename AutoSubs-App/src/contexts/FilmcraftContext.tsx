import React from "react";
import { join } from "@tauri-apps/api/path";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { FilmcraftExportError, filmcraftCommand } from "@/api/filmcraft-api";
import { useIntegration } from "@/contexts/IntegrationContext";
import { useSettingsStore } from "@/stores/settings-store";
import { getAudioExportDir, getSubtitleDocumentPath, loadSubtitleDocumentSubtitles } from "@/utils/file-utils";
import { generateSrt } from "@/utils/srt-utils";
import i18n from "@/i18n";
import type { TimelineInfo } from "@/types";

const emptyTimeline: TimelineInfo = {
  name: "", timelineId: "", projectName: "", inputTracks: [], outputTracks: [],
};

interface FilmcraftContextValue {
  timelineInfo: TimelineInfo;
  isConnected: boolean;
  isExporting: boolean;
  exportProgress: number;
  cancelRequestedRef: React.MutableRefObject<boolean>;
  refresh: () => Promise<void>;
  getSourceAudio: (mode: "file" | "timeline", file: string | null, tracks: string[]) => Promise<{ path: string; offset: number } | null>;
  pushToTimeline: (filename?: string) => Promise<void>;
  jumpToTime: (seconds: number) => Promise<void>;
}

const FilmcraftContext = React.createContext<FilmcraftContextValue | null>(null);

export function FilmcraftProvider({ children }: { children: React.ReactNode }) {
  const { selectedIntegration, filmcraftToken } = useIntegration();
  const exportRange = useSettingsStore((state) => state.exportRange);
  const [timelineInfo, setTimelineInfo] = React.useState<TimelineInfo>(emptyTimeline);
  const [isExporting, setIsExporting] = React.useState(false);
  const [exportProgress, setExportProgress] = React.useState(0);
  const cancelRequestedRef = React.useRef(false);
  const tokenRef = React.useRef(filmcraftToken);
  tokenRef.current = filmcraftToken;

  const refresh = React.useCallback(async () => {
    const token = tokenRef.current;
    if (!token) { setTimelineInfo(emptyTimeline); return; }
    try {
      const result = await filmcraftCommand<Record<string, unknown>>(token, "sequence.inspect");
      const sequence = (result.sequence && typeof result.sequence === "object"
        ? result.sequence : result) as Record<string, unknown>;
      const id = sequence.id ?? sequence.sequenceId;
      if (id == null) {
        if (token === tokenRef.current) setTimelineInfo(emptyTimeline);
        return;
      }
      const project = await filmcraftCommand<Record<string, unknown>>(token, "project.inspect");
      if (token !== tokenRef.current) return;
      setTimelineInfo({
        name: String(sequence.name ?? "Sequence"),
        timelineId: `filmcraft:${String(project.path ?? project.name ?? "project")}:${String(id)}`,
        projectName: String(project.name ?? "FilmCraft"),
        inputTracks: [{ value: "mix", label: i18n.t("filmcraft.mix") }],
        outputTracks: [],
      });
    } catch {
      if (token === tokenRef.current) setTimelineInfo(emptyTimeline);
    }
  }, []);

  React.useEffect(() => {
    if (selectedIntegration !== "filmcraft") return;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [selectedIntegration, filmcraftToken, refresh]);

  const getSourceAudio: FilmcraftContextValue["getSourceAudio"] = async (mode, file) => {
    if (mode === "file") return { path: file ?? "", offset: 0 };
    if (!filmcraftToken || !timelineInfo.timelineId) throw new Error(i18n.t("filmcraft.errors.connectAudio"));
    cancelRequestedRef.current = false;
    setIsExporting(true);
    setExportProgress(0);
    try {
      const path = await join(await getAudioExportDir(), `filmcraft-${Date.now()}.wav`);
      const sequence = await filmcraftCommand<Record<string, unknown>>(filmcraftToken, "sequence.inspect");
      const markIn = exportRange === "inout" && typeof sequence.in === "number"
        ? sequence.in / 254_016_000_000 : 0;
      const started = await filmcraftCommand<{ job: number }>(filmcraftToken, "file.exportMedia", {
        path, format: "wav", sequence: sequence.id,
        range: exportRange === "inout" ? "inOut" : "entire", wait: false,
      });
      if (!Number.isInteger(started.job)) throw new Error(i18n.t("filmcraft.errors.noJob"));
      const deadline = Date.now() + 30 * 60_000;
      while (Date.now() < deadline) {
        if (cancelRequestedRef.current) {
          await filmcraftCommand(filmcraftToken, "jobs.cancel", { job: started.job });
          throw new Error("Cancelled");
        }
        const listed = await filmcraftCommand<unknown>(filmcraftToken, "jobs.list");
        const jobs = Array.isArray(listed) ? listed : (listed && typeof listed === "object" && "jobs" in listed ? (listed as { jobs: unknown }).jobs : []);
        const job = Array.isArray(jobs) ? jobs.find((candidate) => candidate && typeof candidate === "object" && "id" in candidate && candidate.id === started.job) as Record<string, unknown> | undefined : undefined;
        if (job) {
          if (typeof job.progress === "number") setExportProgress(Math.round(job.progress * 100));
          if (job.finished) {
            const result = job.result as Record<string, unknown> | undefined;
            if (result?.error || job.error) throw new Error(String(result?.error ?? job.error));
            if (job.status && /cancel/i.test(String(job.status))) throw new Error("Cancelled");
            setExportProgress(100);
            return { path, offset: markIn };
          }
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      await filmcraftCommand(filmcraftToken, "jobs.cancel", { job: started.job });
      throw new Error(i18n.t("filmcraft.errors.exportTimeout"));
    } catch (error) {
      if (cancelRequestedRef.current) throw error;
      throw new FilmcraftExportError(error);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  async function pushToTimeline(filename?: string) {
    if (!filmcraftToken || !timelineInfo.timelineId) throw new Error(i18n.t("filmcraft.errors.connectSubtitles"));
    if (!filename) throw new Error(i18n.t("filmcraft.errors.noDocument"));
    const sourcePath = await getSubtitleDocumentPath(filename);
    const path = sourcePath.endsWith(".json")
      ? `${sourcePath.slice(0, -5)}.filmcraft.srt`
      : `${sourcePath}.filmcraft.srt`;
    const subtitles = await loadSubtitleDocumentSubtitles(filename);
    await writeTextFile(path, generateSrt(subtitles));
    await filmcraftCommand(filmcraftToken, "captions.import", { path });
  }

  async function jumpToTime(seconds: number) {
    if (!filmcraftToken || !timelineInfo.timelineId) return;
    await filmcraftCommand(filmcraftToken, "playhead.set", { seconds });
  }

  return <FilmcraftContext.Provider value={{
    timelineInfo, isConnected: Boolean(timelineInfo.timelineId),
    isExporting, exportProgress, cancelRequestedRef, refresh, getSourceAudio, pushToTimeline, jumpToTime,
  }}>{children}</FilmcraftContext.Provider>;
}

export function useFilmcraft() {
  const value = React.useContext(FilmcraftContext);
  if (!value) throw new Error("useFilmcraft must be used within FilmcraftProvider");
  return value;
}
