import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FeedbackWidget } from './FeedbackWidget';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useLanguageStore } from '@/stores/language-store';
import type { FeedbackItem, UploadResponse } from '@/types/api';

const api = vi.hoisted(() => ({
  submitFeedback: vi.fn(),
  listMyFeedback: vi.fn(),
  addFeedbackComment: vi.fn(),
  uploadFeedbackAttachment: vi.fn(),
  feedbackAttachmentUrl: vi.fn((id: string) => `/api/feedback/attachments/${id}`),
}));

vi.mock('@/lib/api', () => api);

function plateInfo(): UploadResponse {
  // raw_filename is attached through the cast on purpose: whether the session
  // info carries the uploaded filename or not, the point of the context test
  // below is that the feedback context never copies it.
  return {
    session_id: 'sess-1',
    raw_filename: 'private-samples.pcrd',
    instrument: 'CFX Opus',
    allele2_dye: 'HEX',
    num_wells: 96,
    num_cycles: 40,
    has_rox: false,
    data_windows: null,
    suggested_cycle: 40,
    background_modes: ['none'],
    well_groups: null,
  } as UploadResponse;
}

function feedbackItem(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: 'fb-1',
    owner_user_id: 'user-1',
    owner_name: 'User One',
    category: 'bug',
    title: 'Scatter axes flip after reload',
    body: 'Open a CFX plate, reload, the axes swap.',
    context: { page_key: 'analysis', instrument: 'CFX Opus' },
    status: 'in_progress',
    admin_note: 'internal: reproduced on CFX',
    comments: [],
    attachments: [],
    created_at: '2026-09-11 04:05:06',
    updated_at: '2026-09-11 04:05:06',
    ...overrides,
  };
}

function imageFile(name: string, type = 'image/png', size = 1024): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

async function openWidget() {
  render(<FeedbackWidget pageKey="analysis" />);
  fireEvent.click(screen.getByTestId('feedback-open'));
  await waitFor(() => expect(screen.getByTestId('feedback-title')).toBeInTheDocument());
}

function fillForm(title = 'Axes flip', body = 'Reload and they swap') {
  fireEvent.change(screen.getByTestId('feedback-title'), { target: { value: title } });
  fireEvent.change(screen.getByTestId('feedback-body'), { target: { value: body } });
}

describe('FeedbackWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLanguageStore.setState({ language: 'en' });
    useSessionStore.setState({ sessionId: null, sessionInfo: null, viewStates: {} } as never);
    useSelectionStore.setState({ currentCycle: 0 });
    useSettingsStore.setState({ ploidy: 2 });
    api.listMyFeedback.mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    api.submitFeedback.mockResolvedValue(feedbackItem());
    // jsdom has no object-URL support; previews only need a stable string.
    window.URL.createObjectURL = vi.fn(() => 'blob:preview');
    window.URL.revokeObjectURL = vi.fn();
  });

  it('submits the chosen category with the reporter text', async () => {
    await openWidget();
    fireEvent.click(screen.getByTestId('feedback-category-improvement'));
    fillForm('  Axes flip  ', '  Reload and they swap  ');

    fireEvent.click(screen.getByTestId('feedback-submit'));

    await waitFor(() => expect(api.submitFeedback).toHaveBeenCalledTimes(1));
    const payload = api.submitFeedback.mock.calls[0][0];
    expect(payload.category).toBe('improvement');
    // Trimmed client-side so the stored title is not padded.
    expect(payload.title).toBe('Axes flip');
    expect(payload.body).toBe('Reload and they swap');
    expect(await screen.findByTestId('feedback-submitted')).toBeInTheDocument();
  });

  it('attaches the open run context but never its sample identity', async () => {
    useSessionStore.getState().setSession('sess-1', plateInfo());
    useSessionStore.setState({ viewStates: { 'sess-1': { activeSurface: 'plate' } } } as never);
    useSelectionStore.setState({ currentCycle: 40 });
    useSettingsStore.setState({ ploidy: 6 });

    await openWidget();
    fillForm();
    fireEvent.click(screen.getByTestId('feedback-submit'));

    await waitFor(() => expect(api.submitFeedback).toHaveBeenCalledTimes(1));
    const { context } = api.submitFeedback.mock.calls[0][0];
    expect(context).toMatchObject({
      page_key: 'analysis',
      surface: 'plate',
      session_id: 'sess-1',
      instrument: 'CFX Opus',
      num_wells: 96,
      num_cycles: 40,
      ploidy: 6,
      cycle: 40,
      language: 'en',
    });
    // The plate's own identity stays out of the report entirely.
    expect(JSON.stringify(context)).not.toContain('private-samples');
  });

  it('omits an unanalysed cycle rather than reporting cycle 0', async () => {
    await openWidget();
    fillForm();
    fireEvent.click(screen.getByTestId('feedback-submit'));

    await waitFor(() => expect(api.submitFeedback).toHaveBeenCalled());
    expect(api.submitFeedback.mock.calls[0][0].context).not.toHaveProperty('cycle');
  });

  it('uploads a chosen screenshot and submits its id', async () => {
    api.uploadFeedbackAttachment.mockResolvedValue({
      id: 'att-1',
      filename: 'shot.png',
      mime_type: 'image/png',
      size_bytes: 1024,
    });

    await openWidget();
    fireEvent.change(screen.getByTestId('feedback-file-input'), {
      target: { files: [imageFile('shot.png')] },
    });

    await waitFor(() => expect(api.uploadFeedbackAttachment).toHaveBeenCalledTimes(1));
    expect(await screen.findByAltText('shot.png')).toBeInTheDocument();

    fillForm();
    fireEvent.click(screen.getByTestId('feedback-submit'));

    await waitFor(() => expect(api.submitFeedback).toHaveBeenCalled());
    expect(api.submitFeedback.mock.calls[0][0].attachment_ids).toEqual(['att-1']);
  });

  it('rejects an oversized or non-image file before uploading anything', async () => {
    await openWidget();

    fireEvent.change(screen.getByTestId('feedback-file-input'), {
      target: { files: [imageFile('huge.png', 'image/png', 3 * 1024 * 1024)] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('huge.png');

    fireEvent.change(screen.getByTestId('feedback-file-input'), {
      target: { files: [imageFile('notes.gif', 'image/gif')] },
    });
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('notes.gif')
    );

    expect(api.uploadFeedbackAttachment).not.toHaveBeenCalled();
  });

  it('stops at four screenshots', async () => {
    let n = 0;
    api.uploadFeedbackAttachment.mockImplementation(async (file: File) => {
      n += 1;
      return { id: `att-${n}`, filename: file.name, mime_type: 'image/png', size_bytes: 1024 };
    });

    await openWidget();
    fireEvent.change(screen.getByTestId('feedback-file-input'), {
      target: {
        files: [
          imageFile('a.png'),
          imageFile('b.png'),
          imageFile('c.png'),
          imageFile('d.png'),
          imageFile('e.png'),
        ],
      },
    });

    await waitFor(() => expect(api.uploadFeedbackAttachment).toHaveBeenCalledTimes(4));
    expect(screen.getByRole('alert')).toHaveTextContent('4');
  });

  it('adds a pasted screenshot from the clipboard', async () => {
    api.uploadFeedbackAttachment.mockResolvedValue({
      id: 'att-paste',
      filename: 'clipboard.png',
      mime_type: 'image/png',
      size_bytes: 2048,
    });

    await openWidget();
    const pasted = imageFile('clipboard.png');
    fireEvent.paste(screen.getByTestId('feedback-dropzone'), {
      clipboardData: { files: [pasted], items: [] },
    });

    await waitFor(() => expect(api.uploadFeedbackAttachment).toHaveBeenCalledWith(pasted));
  });

  it('lists my own feedback with the admin reply and posts a comment', async () => {
    api.listMyFeedback.mockResolvedValue({
      items: [
        feedbackItem({
          comments: [
            {
              id: 'c-1',
              feedback_id: 'fb-1',
              author_user_id: 'admin-1',
              author_name: 'Administrator',
              body: 'Fixed in the next build',
              is_admin: true,
              created_at: '2026-09-11 05:00:00',
            },
          ],
        }),
      ],
      total: 1,
      page: 1,
      per_page: 20,
    });
    api.addFeedbackComment.mockResolvedValue({
      id: 'c-2',
      feedback_id: 'fb-1',
      author_user_id: 'user-1',
      author_name: 'User One',
      body: 'Still happening',
      is_admin: false,
      created_at: '2026-09-11 06:00:00',
    });

    await openWidget();
    fireEvent.click(screen.getByTestId('feedback-subtab-mine'));

    expect(await screen.findByText('Scatter axes flip after reload')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(await screen.findByText('Fixed in the next build')).toBeInTheDocument();
    // The internal note is admin-only and must not leak to the reporter.
    expect(screen.queryByText(/internal: reproduced on CFX/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Add comment'), {
      target: { value: 'Still happening' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));

    await waitFor(() =>
      expect(api.addFeedbackComment).toHaveBeenCalledWith('fb-1', 'Still happening')
    );
    // A posted comment refetches, so the thread shows what the server stored.
    expect(api.listMyFeedback).toHaveBeenCalledTimes(2);
  });

  it('shows an empty state when nothing has been sent', async () => {
    await openWidget();
    fireEvent.click(screen.getByTestId('feedback-subtab-mine'));
    expect(await screen.findByText('You have not sent any feedback yet.')).toBeInTheDocument();
  });
});
