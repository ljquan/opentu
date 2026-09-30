/** Disable new paid submissions while keeping local history and query/download available. */
export const documentBatchSubmissionEnabled = () => import.meta.env.VITE_DOCUMENT_BATCH_SUBMISSION !== 'false';

export function assertDocumentBatchSubmissionEnabled(): void {
    if (!documentBatchSubmissionEnabled()) throw new Error('批量提交已停用，仍可查看历史与下载结果');
}
