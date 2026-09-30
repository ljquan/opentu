import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { queryWorkflowImageResult } from '../src/services/api/image-recovery';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../../services/provider-routing/tuzi-api-endpoints', async importOriginal => ({
    ...await importOriginal<typeof import('../../../services/provider-routing/tuzi-api-endpoints')>(),
    loadTuziApiEndpointBaseUrls: vi.fn(async () => ['https://api.tu-zi.com', 'https://bus.tu-zi.com', 'https://untrusted.example']),
}));
beforeEach(() => vi.clearAllMocks());

describe('workflow image recovery uses the canvas query contract', () => {
    it('queries a trusted fallback after the original transport fails, keeping request id and credential', async () => {
        vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({ data: { status: 'succeeded', data: [{ url: 'https://example.test/result.png' }] } });
        expect(await queryWorkflowImageResult('https://api.tu-zi.com', 'fictional-key', 'attempt')).toMatchObject({ status: 'succeeded' });
        expect(axios.get).toHaveBeenCalledTimes(2);
        expect(axios.get).toHaveBeenLastCalledWith('https://bus.tu-zi.com/v1/images/generations/result?request_id=attempt', expect.objectContaining({ headers: { authorization: 'Bearer fictional-key', 'x-request-id': 'attempt' } }));
    });
    it.each([401, 403, 400])('preserves HTTP %s query errors without retrying another node', async status => {
        const error = Object.assign(new Error('denied'), { response: { status } });
        vi.mocked(axios.get).mockRejectedValueOnce(error);
        await expect(queryWorkflowImageResult('https://api.tu-zi.com', 'fictional-key', 'attempt')).rejects.toBe(error);
        expect(axios.get).toHaveBeenCalledTimes(1);
    });
    it.each(['processing_or_not_found', 'failed'])('does not fail over a valid %s response', async status => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: { status } });
        expect(await queryWorkflowImageResult('https://api.tu-zi.com', 'fictional-key', 'attempt')).toEqual({ status });
        expect(axios.get).toHaveBeenCalledTimes(1);
    });
    it('never sends credentials to an untrusted fallback', async () => {
        vi.mocked(axios.get).mockRejectedValue(new Error('offline'));
        await expect(queryWorkflowImageResult('https://api.tu-zi.com', 'fictional-key', 'attempt')).rejects.toThrow('offline');
        expect(axios.get).toHaveBeenCalledTimes(2);
        expect(vi.mocked(axios.get).mock.calls.every(([url]) => !url.includes('untrusted'))).toBe(true);
    });
});
