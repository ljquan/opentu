import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Link, useLocation, useParams } from 'react-router-dom';
import { WorkflowRouter } from '../src/router';
import { navigateWorkflow } from '../../host/workflow-navigation';

vi.mock('@/components/layout/analytics-tracker', () => ({ AnalyticsTracker: () => null }));
vi.mock('@/layouts/user-layout', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/pages/canvas', () => ({ default: () => <Link to="/canvas/project-a">Open project</Link> }));
vi.mock('@/pages/canvas/project', () => ({ default: function ProjectPage() { return <div>Project {useParams().id}<Link to="/image" state={{ project: 'project-a' }}>Images</Link></div>; } }));
vi.mock('@/pages/image', () => ({ default: function ImagePage() { return <div>Images {useLocation().state?.project}</div>; } }));
vi.mock('@/pages/assets', () => ({ default: () => null }));
vi.mock('@/pages/config', () => ({ default: () => null }));
vi.mock('@/pages/not-found', () => ({ default: () => <div>Missing</div> }));
vi.mock('@/pages/prompts', () => ({ default: () => null }));
vi.mock('@/pages/video', () => ({ default: () => <div>Video</div> }));
afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

describe('workflow nested routes', () => {
    it('updates state on push, replace and popstate without changing the URL', () => {
        window.history.replaceState({ usr: { project: 'first' } }, '', '/workflow/image');
        render(<WorkflowRouter />);
        expect(screen.getByText('Images first')).toBeTruthy();
        act(() => navigateWorkflow('/workflow/image', false, { project: 'second' }));
        expect(screen.getByText('Images second')).toBeTruthy();
        act(() => navigateWorkflow('/workflow/image', true, { project: 'third' }));
        expect(screen.getByText('Images third')).toBeTruthy();
        act(() => {
            window.history.replaceState({ usr: { project: 'first' } }, '', '/workflow/image');
            window.dispatchEvent(new PopStateEvent('popstate'));
        });
        expect(screen.getByText('Images first')).toBeTruthy();
    });
    it('keeps links, route params and navigation state in shared browser history', () => {
        window.history.replaceState({ workflowReturnUrl: '/?board=a' }, '', '/workflow');
        render(<WorkflowRouter />);
        expect(screen.getByRole('link', { name: 'Open project' }).getAttribute('href')).toBe('/workflow/canvas/project-a');
        fireEvent.click(screen.getByRole('link', { name: 'Open project' }));
        expect(screen.getByText('Project project-a')).toBeTruthy();
        expect(window.location.pathname).toBe('/workflow/canvas/project-a');
        fireEvent.click(screen.getByRole('link', { name: 'Images' }));
        expect(screen.getByText('Images project-a')).toBeTruthy();
        expect(window.history.state.workflowReturnUrl).toBe('/?board=a');
    });
    it('opens deep URLs and follows host navigation and popstate', () => {
        window.history.replaceState(null, '', '/workflow/canvas/existing');
        render(<WorkflowRouter />);
        expect(screen.getByText('Project existing')).toBeTruthy();
        act(() => navigateWorkflow('/workflow/video'));
        expect(screen.getByText('Video')).toBeTruthy();
        act(() => {
            window.history.replaceState(null, '', '/workflow/canvas/existing');
            window.dispatchEvent(new PopStateEvent('popstate'));
        });
        expect(screen.getByText('Project existing')).toBeTruthy();
    });
    it('rejects navigation outside the workflow boundary', () => {
        expect(() => navigateWorkflow('https://foreign.test/workflow')).toThrow('无效');
        expect(() => navigateWorkflow('/?board=a')).toThrow('无效');
    });
});
