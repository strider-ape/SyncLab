export interface HttpRequest {
	url: string;
	method: 'GET' | 'HEAD' | 'POST';
	headers: Record<string, string>;
	body?: string;
}

export interface HttpResponse {
	status: number;
	/** Header names are lowercased. */
	headers: Record<string, string>;
	arrayBuffer: ArrayBuffer;
	text: string;
}

/** Sends one request and returns whatever status came back. Throws only on network failure. */
export type HttpFn = (request: HttpRequest) => Promise<HttpResponse>;

export function lowercaseHeaders(headers: Record<string, string> | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers ?? {})) out[name.toLowerCase()] = value;
	return out;
}
