/**
 * Speech Analytics Player API
 *
 * Nota tecnica (autenticacion):
 * Esta API usa Application Default Credentials (ADC) del entorno Google Cloud.
 * No requiere archivo JSON de clave de cuenta de servicio.
 *
 * En produccion (por ejemplo, una VM de Compute Engine), la VM debe tener
 * una cuenta de servicio asociada con estos permisos sobre BigQuery:
 *   - BigQuery Data Viewer
 *   - BigQuery Job User
 *
 * Para verificar la cuenta de servicio de la VM:
 *   curl -H "Metadata-Flavor: Google" \
 *     "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email"
 */

import { NextRequest, NextResponse } from "next/server";
import { BigQuery } from "@google-cloud/bigquery";

function safeDateToIso(value: unknown): string {
	if (!value) return "";
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "object" && value !== null && "value" in value) {
		const date = new Date(String((value as Record<string, unknown>).value));
		return Number.isNaN(date.getTime()) ? "" : date.toISOString();
	}
	const date = new Date(String(value));
	return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function safeJsonParse(value: unknown): unknown {
	if (value === null || value === undefined) return null;
	if (typeof value === "object") return value;
	if (typeof value === "string") {
		try {
			return JSON.parse(value);
		} catch {
			return null;
		}
	}
	return null;
}

function extractSegments(value: unknown): Array<Record<string, unknown>> {
	const parsed = safeJsonParse(value);
	if (!parsed) return [];
	if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
	if (typeof parsed === "object" && "segments" in parsed && Array.isArray(parsed.segments)) {
		return parsed.segments as Array<Record<string, unknown>>;
	}
	return [];
}

function normalizeSegments(segmentsRaw: unknown, rawTimeline: unknown): Array<Record<string, unknown>> {
	const segments = extractSegments(segmentsRaw);
	if (segments.length > 0) return segments;
	return extractSegments(rawTimeline);
}

function pickSegmentStart(seg: Record<string, unknown>): number {
	return Number(seg.start ?? seg.start_seconds ?? seg.start_time ?? 0) || 0;
}

function pickSegmentEnd(seg: Record<string, unknown>): number {
	const start = pickSegmentStart(seg);
	const explicitEnd = seg.end ?? seg.end_seconds ?? seg.end_time;
	const duration = seg.duration ?? seg.duration_seconds;
	const parsedEnd = Number(explicitEnd);
	if (explicitEnd !== undefined && explicitEnd !== null && !Number.isNaN(parsedEnd)) {
		return parsedEnd;
	}
	const parsedDuration = Number(duration);
	if (duration !== undefined && duration !== null && !Number.isNaN(parsedDuration)) {
		return start + parsedDuration;
	}
	return start;
}

function pickSegmentDuration(seg: Record<string, unknown>): number {
	const start = pickSegmentStart(seg);
	const end = pickSegmentEnd(seg);
	const explicitDuration = Number(seg.duration_seconds ?? seg.duration);
	if (!Number.isNaN(explicitDuration)) return explicitDuration;
	return end - start;
}

function pickSegmentSpeaker(seg: Record<string, unknown>): string {
	return String(seg.speaker_label ?? seg.speaker ?? seg.role ?? "unknown");
}

function pickSegmentText(seg: Record<string, unknown>): string {
	return String(seg.text ?? seg.transcript ?? "");
}

function normalizeSilences(rawTimeline: unknown): Array<{ start: number; end: number; duration: number }> {
	const parsed = safeJsonParse(rawTimeline);
	if (!parsed) return [];

	const silences: Array<{ start: number; end: number; duration: number }> = [];

	function pushSilence(item: Record<string, unknown>) {
		const start = Number(item.start ?? item.start_seconds ?? item.silence_start ?? 0) || 0;
		const end = Number(item.end ?? item.end_seconds ?? item.silence_end ?? 0) || 0;
		const rawDuration = Number(item.duration ?? item.duration_seconds ?? 0) || 0;
		const duration = rawDuration > 0 ? rawDuration : end - start;
		silences.push({ start, end, duration });
	}

	if (Array.isArray(parsed)) {
		for (const item of parsed) {
			if (!item || typeof item !== "object") continue;
			if ("type" in item && item.type === "silence") {
				pushSilence(item as Record<string, unknown>);
			} else if ("silence_start" in item || "start" in item || "start_seconds" in item) {
				pushSilence(item as Record<string, unknown>);
			}
		}
		return silences;
	}

	if (typeof parsed === "object" && "silences" in parsed && Array.isArray(parsed.silences)) {
		for (const item of parsed.silences) {
			if (item && typeof item === "object") {
				pushSilence(item as Record<string, unknown>);
			}
		}
	}

	return silences;
}

function detectRiskTags(segments: Array<Record<string, unknown>>): Array<{ label: string; severity: "high" | "medium" | "low"; type: string; start: number; end: number }> {
	const tags: Array<{ label: string; severity: "high" | "medium" | "low"; type: string; start: number; end: number }> = [];

	const highPatterns = ["reclamo", "voy a reclamar", "nadie me responde"];
	const mediumPatterns1 = ["desafili", "renunciar", "me quiero salir", "me voy a cambiar"];
	const mediumPatterns2 = ["molesto", "molesta", "no me han respondido", "llevo esperando"];

	for (const seg of segments) {
		if (!seg || typeof seg !== "object") continue;
		const text = String(seg.text ?? seg.transcript ?? "").toLowerCase();
		const start = pickSegmentStart(seg);
		const end = pickSegmentEnd(seg);

		if (!text) continue;

		for (const pattern of highPatterns) {
			if (text.includes(pattern.toLowerCase())) {
				tags.push({ label: "Riesgo de reclamo", severity: "high", type: "risk", start, end });
				break;
			}
		}

		for (const pattern of mediumPatterns1) {
			if (text.includes(pattern.toLowerCase())) {
				tags.push({ label: "Mencion de desafiliacion", severity: "medium", type: "risk", start, end });
				break;
			}
		}

		for (const pattern of mediumPatterns2) {
			if (text.includes(pattern.toLowerCase())) {
				tags.push({ label: "Molestia cliente", severity: "medium", type: "risk", start, end });
				break;
			}
		}
	}

	return tags;
}

function buildSilenceTags(silences: Array<{ start: number; end: number; duration: number }>): Array<{ label: string; severity: "high" | "medium" | "low"; type: string; start: number; end: number }> {
	return silences.filter((s) => s.duration >= 2).map((s) => {
		if (s.duration >= 15) return { label: "Silencio critico", severity: "high", type: "silence", start: s.start, end: s.end };
		if (s.duration >= 5) return { label: "Silencio largo", severity: "medium", type: "silence", start: s.start, end: s.end };
		return { label: "Pausa operacional", severity: "low", type: "silence", start: s.start, end: s.end };
	});
}

function getBigQueryClient(): BigQuery {
	const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || "xia-speech-15062026";
	return new BigQuery({ projectId });
}

export async function GET(request: NextRequest) {
	try {
		const { searchParams } = new URL(request.url);
		const callId = searchParams.get("call_id");

		if (!callId || typeof callId !== "string" || callId.trim().length === 0) {
			return NextResponse.json({ ok: false, error: "call_id es requerido" }, { status: 400 });
		}

		const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || "xia-speech-15062026";
		const dataset = process.env.BIGQUERY_DATASET || "speech_analytics";
		const table = process.env.BIGQUERY_TIMELINE_TABLE || "speech_analytics_timeline";

		const bq = getBigQueryClient();

		const query = `
			SELECT
				call_id,
				audio_url,
				language,
				start_time,
				duration_seconds,
				total_speech_seconds,
				total_silence_seconds,
				silence_percentage,
				agent_talk_time,
				client_talk_time,
				longest_silence_seconds,
				silence_count,
				critical_silence_count,
				transcript_text,
				vtt,
				srt,
				speakers_json,
				segments_json,
				metrics_json,
				raw_timeline_json,
				created_at
			FROM \`${projectId}.${dataset}.${table}\`
			WHERE call_id = @call_id
			ORDER BY created_at DESC
			LIMIT 1
		`;

		const [rows] = await bq.query({
			query,
			params: { call_id: callId },
		});

		if (!rows || rows.length === 0) {
			return NextResponse.json({ ok: false, error: "Llamada no encontrada" }, { status: 404 });
		}

		const row = rows[0] as Record<string, unknown>;

		const segments = normalizeSegments(row.segments_json, row.raw_timeline_json);
		const silences = normalizeSilences(row.raw_timeline_json);
		const silenceTags = buildSilenceTags(silences);
		const riskTags = detectRiskTags(segments);
		const tags = [...silenceTags, ...riskTags];

		const metricsParsed = safeJsonParse(row.metrics_json) as Record<string, unknown> | null;

		const response = {
			ok: true,
			call: {
				call_id: String(row.call_id ?? ""),
				audio_url: String(row.audio_url ?? ""),
				language: String((metricsParsed?.language ?? row.language ?? "") as string),
				start_time: safeDateToIso(row.start_time),
				created_at: safeDateToIso(row.created_at),
				duration_seconds: Number(row.duration_seconds ?? 0) || 0,
				transcript_text: String(row.transcript_text ?? ""),
				vtt: String(row.vtt ?? ""),
				srt: String(row.srt ?? ""),
			},
			metrics: {
				duration_seconds: Number(row.duration_seconds ?? 0) || 0,
				total_speech_seconds: Number(row.total_speech_seconds ?? 0) || 0,
				total_silence_seconds: Number(row.total_silence_seconds ?? 0) || 0,
				silence_percentage: Number(row.silence_percentage ?? 0) || 0,
				agent_talk_time: Number(row.agent_talk_time ?? 0) || 0,
				client_talk_time: Number(row.client_talk_time ?? 0) || 0,
				longest_silence_seconds: Number(row.longest_silence_seconds ?? 0) || 0,
				silence_count: Number(row.silence_count ?? 0) || 0,
				critical_silence_count: Number(row.critical_silence_count ?? 0) || 0,
			},
			segments: segments.map((seg) => ({
				start: pickSegmentStart(seg),
				end: pickSegmentEnd(seg),
				duration: pickSegmentDuration(seg),
				speaker: pickSegmentSpeaker(seg),
				text: pickSegmentText(seg),
			})),
			silences: silences.map((s) => ({
				start: s.start,
				end: s.end,
				duration: s.duration,
			})),
			events: [],
			tags: tags.map((t) => ({
				label: t.label,
				severity: t.severity,
				type: t.type,
				start: t.start,
				end: t.end,
			})),
		};

		return NextResponse.json(response);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Error interno del servidor";
		console.error("[speech-player] error:", error);
		return NextResponse.json({ ok: false, error: message }, { status: 500 });
	}
}
