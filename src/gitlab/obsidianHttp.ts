import { requestUrl } from 'obsidian';
import { lowercaseHeaders, type HttpFn } from './http';

/** HttpFn backed by Obsidian's requestUrl: no CORS limits, works on desktop and mobile. */
export const obsidianHttp: HttpFn = async request => {
	const response = await requestUrl({
		url: request.url,
		method: request.method,
		headers: request.headers,
		body: request.body,
		contentType: request.body === undefined ? undefined : 'application/json',
		throw: false,
	});
	const headers = lowercaseHeaders(response.headers);
	// HEAD responses have no body; reading .text on some platforms throws.
	if (request.method === 'HEAD') {
		return { status: response.status, headers, arrayBuffer: new ArrayBuffer(0), text: '' };
	}
	return { status: response.status, headers, arrayBuffer: response.arrayBuffer, text: response.text };
};
