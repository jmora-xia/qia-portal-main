"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";

interface Segment {
	start: number;
	end: number;
	speaker: string;
	text: string;
}

interface Silence {
	start: number;
	end: number;
	duration: number;
}

interface Tag {
	label: string;
	severity: "high" | "medium" | "low";
	type: string;
	start: number;
	end: number;
}

interface CallData {
	call_id: string;
	audio_url: string;
	language: string;
	start_time: string;
	created_at: string;
	duration_seconds: number;
	transcript_text: string;
	vtt: string;
	srt: string;
}

interface MetricsData {
	duration_seconds: number;
	total_speech_seconds: number;
	total_silence_seconds: number;
	silence_percentage: number;
	agent_talk_time: number;
	client_talk_time: number;
	longest_silence_seconds: number;
	silence_count: number;
	critical_silence_count: number;
}

interface ApiResponse {
	ok: boolean;
	call: CallData;
	metrics: MetricsData;
	segments: Segment[];
	silences: Silence[];
	events: Tag[];
	tags: Tag[];
	error?: string;
}

function formatTime(totalSeconds: number): string {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = Math.floor(totalSeconds % 60);
	return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function getSpeakerColor(speaker: string): string {
	const spk = speaker.toLowerCase();
	if (spk.includes("agente") || spk.includes("agent") || spk.includes("operador")) return "bg-blue-500";
	if (spk.includes("cliente") || spk.includes("customer") || spk.includes("user")) return "bg-emerald-500";
	if (spk.includes("ivr") || spk.includes("bot") || spk.includes("system")) return "bg-slate-500";
	return "bg-zinc-500";
}

function getSeverityColor(severity: string): string {
	if (severity === "high") return "bg-red-500";
	if (severity === "medium") return "bg-amber-500";
	return "bg-violet-500";
}

function getSeverityBadgeClass(severity: string): string {
	if (severity === "high") return "bg-red-500/15 text-red-400 border-red-500/30";
	if (severity === "medium") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
	return "bg-violet-500/15 text-violet-400 border-violet-500/30";
}

export default function PlayerPage() {
	const [, setCallId] = useState<string>("");
	const [data, setData] = useState<ApiResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [isPlaying, setIsPlaying] = useState(false);
	const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);

	const audioRef = useRef<HTMLAudioElement | null>(null);
	const timelineRef = useRef<HTMLDivElement | null>(null);
	const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
	const progressBarRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const params = new URLSearchParams(window.location.search);
		const id = params.get("call_id");
		if (!id) {
			setError("No se proporciono call_id en la URL. Use ?call_id=...");
			setLoading(false);
			return;
		}
		setCallId(id);

		fetch(`/api/speech-player?call_id=${encodeURIComponent(id)}`)
			.then((res) => res.json())
			.then((json: ApiResponse) => {
				if (!json.ok) {
					setError(json.error || "Error al cargar la llamada");
				} else {
					setData(json);
				}
				setLoading(false);
			})
			.catch((err) => {
				setError(err instanceof Error ? err.message : "Error de red");
				setLoading(false);
			});
	}, []);

	const handleTimeUpdate = useCallback(() => {
		const audio = audioRef.current;
		if (!audio) return;
		setCurrentTime(audio.currentTime);

		if (data?.segments) {
			const idx = data.segments.findIndex(
				(seg) => audio.currentTime >= seg.start && audio.currentTime < seg.end
			);
			setActiveSegmentIndex(idx >= 0 ? idx : null);
		}
	}, [data]);

	const handleLoadedMetadata = useCallback(() => {
		const audio = audioRef.current;
		if (!audio) return;
		setDuration(audio.duration || (data?.metrics?.duration_seconds ?? 0));
	}, [data]);

	const handlePlayPause = useCallback(() => {
		const audio = audioRef.current;
		if (!audio) return;
		if (audio.paused) {
			audio.play();
			setIsPlaying(true);
		} else {
			audio.pause();
			setIsPlaying(false);
		}
	}, []);

	const seekTo = useCallback((time: number) => {
		const audio = audioRef.current;
		if (!audio) return;
		const clamped = Math.max(0, Math.min(time, audio.duration || duration));
		audio.currentTime = clamped;
		setCurrentTime(clamped);
	}, [duration]);

	const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
		const bar = timelineRef.current;
		if (!bar) return;
		const rect = bar.getBoundingClientRect();
		const ratio = (e.clientX - rect.left) / rect.width;
		const target = ratio * (duration || data?.metrics?.duration_seconds || 1);
		seekTo(target);
	}, [duration, data, seekTo]);

	const handleProgressBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
		const bar = progressBarRef.current;
		if (!bar) return;
		const rect = bar.getBoundingClientRect();
		const ratio = (e.clientX - rect.left) / rect.width;
		const target = ratio * (duration || data?.metrics?.duration_seconds || 1);
		seekTo(target);
	}, [duration, data, seekTo]);

	const jumpToSegment = useCallback((index: number) => {
		if (!data?.segments[index]) return;
		seekTo(data.segments[index].start);
		segmentRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "center" });
	}, [data, seekTo]);

	const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

	useEffect(() => {
		if (activeSegmentIndex !== null && segmentRefs.current[activeSegmentIndex]) {
			segmentRefs.current[activeSegmentIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	}, [activeSegmentIndex]);

	if (loading) {
		return (
			<div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
				<div className="flex flex-col items-center gap-4">
					<div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
					<p className="text-zinc-400 text-sm">Cargando llamada...</p>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
				<div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 max-w-md w-full text-center">
					<div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center mx-auto mb-4">
						<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
							<circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
						</svg>
					</div>
					<h1 className="text-lg font-semibold mb-2">Error</h1>
					<p className="text-zinc-400 text-sm">{error}</p>
				</div>
			</div>
		);
	}

	if (!data) {
		return (
			<div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
				<div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 max-w-md w-full text-center">
					<p className="text-zinc-400 text-sm">No se encontraron datos.</p>
				</div>
			</div>
		);
	}

	const { call, metrics, segments, silences, tags } = data;
	const totalDuration = duration || metrics.duration_seconds || 1;

	const allEvents = tags || [];

	return (
		<div className="min-h-screen bg-zinc-950 text-zinc-100">
			<main className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
				{/* Header */}
				<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
					<div>
						<h1 className="text-xl font-semibold tracking-tight">Speech Analytics Player</h1>
						<p className="text-zinc-400 text-sm mt-1">Call ID: <span className="font-mono text-zinc-300">{call.call_id}</span></p>
					</div>
					<div className="flex items-center gap-2 text-xs text-zinc-500">
						<span>{call.created_at ? new Date(call.created_at).toLocaleString("es-CL") : ""}</span>
						<span className="inline-flex items-center px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-xs">{call.language || "es"}</span>
					</div>
				</div>

				{/* Audio Player */}
				<div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 md:p-5">
					<audio
						ref={audioRef}
						src={call.audio_url}
						preload="metadata"
						onTimeUpdate={handleTimeUpdate}
						onLoadedMetadata={handleLoadedMetadata}
						onEnded={() => setIsPlaying(false)}
						onPlay={() => setIsPlaying(true)}
						onPause={() => setIsPlaying(false)}
						className="w-full mb-3"
						controls
					/>
					<div className="flex items-center gap-3">
						<button
							onClick={handlePlayPause}
							className="w-10 h-10 rounded-full bg-cyan-500 text-zinc-950 flex items-center justify-center hover:bg-cyan-400 transition-colors shrink-0"
						>
							{isPlaying ? (
								<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
							) : (
								<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
							)}
						</button>
						<div className="flex-1">
							<div
								ref={progressBarRef}
								onClick={handleProgressBarClick}
								className="h-2 bg-zinc-800 rounded-full cursor-pointer relative overflow-hidden"
							>
								<div
									className="absolute top-0 left-0 h-full bg-cyan-500 rounded-full transition-all duration-100"
									style={{ width: `${progressPercent}%` }}
								/>
							</div>
							<div className="flex justify-between text-xs text-zinc-500 mt-1">
								<span>{formatTime(currentTime)}</span>
								<span>{formatTime(totalDuration)}</span>
							</div>
						</div>
					</div>
				</div>

				{/* Metrics */}
				<div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
					<MetricCard label="Duracion" value={formatTime(metrics.duration_seconds)} />
					<MetricCard label="Silencio" value={`${metrics.silence_percentage.toFixed(1)}%`} accent="text-violet-400" />
					<MetricCard label="Tiempo Agente" value={formatTime(metrics.agent_talk_time)} accent="text-blue-400" />
					<MetricCard label="Tiempo Cliente" value={formatTime(metrics.client_talk_time)} accent="text-emerald-400" />
					<MetricCard label="Silencio mas largo" value={`${metrics.longest_silence_seconds.toFixed(1)}s`} />
					<MetricCard label="Cantidad silencios" value={String(metrics.silence_count)} />
					<MetricCard label="Silencios criticos" value={String(metrics.critical_silence_count)} accent="text-red-400" />
					<MetricCard label="Tiempo hablado" value={formatTime(metrics.total_speech_seconds)} />
				</div>

				{/* Timeline */}
				<div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 md:p-5">
					<div className="flex items-center justify-between mb-3">
						<h2 className="text-sm font-medium text-zinc-300">Linea de tiempo</h2>
						<div className="flex items-center gap-3 text-xs text-zinc-500">
							<span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" />Agente</span>
							<span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Cliente</span>
							<span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-500" />Silencio</span>
							<span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />Riesgo alto</span>
							<span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />Riesgo medio</span>
						</div>
					</div>
					<div
						ref={timelineRef}
						onClick={handleTimelineClick}
						className="relative h-16 bg-zinc-950 rounded-lg border border-zinc-800 cursor-pointer overflow-hidden select-none"
					>
						{/* Segments */}
						{segments.map((seg, i) => {
							const left = (seg.start / totalDuration) * 100;
							const width = Math.max(((seg.end - seg.start) / totalDuration) * 100, 0.3);
							return (
								<div
									key={`seg-${i}`}
									title={`${seg.speaker}: ${seg.text}`}
									className={`absolute top-0 h-full ${getSpeakerColor(seg.speaker)} opacity-70 hover:opacity-100 transition-opacity`}
									style={{ left: `${left}%`, width: `${width}%` }}
								/>
							);
						})}

						{/* Silences */}
						{silences.map((sil, i) => {
							const left = (sil.start / totalDuration) * 100;
							const width = Math.max((sil.duration / totalDuration) * 100, 0.3);
							return (
								<div
									key={`sil-${i}`}
									title={`Silencio: ${sil.duration.toFixed(1)}s`}
									className="absolute top-0 h-full bg-violet-500/40 border border-violet-500/50 hover:bg-violet-500/60 transition-colors"
									style={{ left: `${left}%`, width: `${width}%` }}
								/>
							);
						})}

						{/* Event / Tag markers */}
						{allEvents.map((ev, i) => {
							const left = (ev.start / totalDuration) * 100;
							return (
								<button
									key={`ev-${i}`}
									title={`${ev.label} (${ev.severity})`}
									onClick={(e) => {
										e.stopPropagation();
										seekTo(ev.start);
									}}
									className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full ${getSeverityColor(ev.severity)} border-2 border-zinc-950 hover:scale-125 transition-transform z-10`}
									style={{ left: `calc(${left}% - 6px)` }}
								/>
							);
						})}

						{/* Current time cursor */}
						<div
							className="absolute top-0 h-full w-0.5 bg-cyan-400 z-20 pointer-events-none"
							style={{ left: `${progressPercent}%` }}
						/>
					</div>

					{/* Tags list */}
					{allEvents.length > 0 && (
						<div className="flex flex-wrap gap-2 mt-3">
							{allEvents.map((ev, i) => (
								<button
									key={`tag-${i}`}
									onClick={() => seekTo(ev.start)}
									className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors hover:bg-white/5 ${getSeverityBadgeClass(ev.severity)}`}
								>
									<span className={`w-1.5 h-1.5 rounded-full ${getSeverityColor(ev.severity)}`} />
									{ev.label}
									<span className="text-zinc-500 ml-1">{formatTime(ev.start)}</span>
								</button>
							))}
						</div>
					)}
				</div>

				{/* Transcript */}
				<div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 md:p-5">
					<h2 className="text-sm font-medium text-zinc-300 mb-3">Transcripcion</h2>
					<div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
						{segments.map((seg, i) => {
							const isActive = activeSegmentIndex === i;
							return (
								<div
									key={`seg-row-${i}`}
									ref={(el) => { segmentRefs.current[i] = el; }}
									onClick={() => jumpToSegment(i)}
									className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer border transition-colors ${
										isActive
											? "bg-zinc-800/80 border-cyan-500/40"
											: "bg-zinc-950 border-zinc-800 hover:border-zinc-700"
									}`}
								>
									<div className="shrink-0 pt-0.5">
										<div className={`w-2 h-2 rounded-full ${getSpeakerColor(seg.speaker)}`} />
									</div>
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2 mb-1">
											<span className="text-xs font-medium text-zinc-400 uppercase">{seg.speaker}</span>
											<span className="text-xs text-zinc-600">{formatTime(seg.start)} - {formatTime(seg.end)}</span>
										</div>
										<p className="text-sm text-zinc-200 leading-relaxed">{seg.text}</p>
									</div>
								</div>
							);
							})}
							{segments.length === 0 && (
								<p className="text-zinc-500 text-sm">No hay segmentos disponibles.</p>
							)}
						</div>
					</div>

					{/* Raw Transcript */}
					{call.transcript_text && (
						<div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 md:p-5">
							<h2 className="text-sm font-medium text-zinc-300 mb-3">Transcripcion completa</h2>
							<div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 max-h-64 overflow-y-auto">
								<p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{call.transcript_text}</p>
							</div>
						</div>
					)}
			</main>
		</div>
	);
}

function MetricCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
	return (
		<div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
			<p className="text-xs text-zinc-500 mb-1">{label}</p>
			<p className={`text-lg font-semibold ${accent || "text-zinc-100"}`}>{value}</p>
		</div>
	);
}
