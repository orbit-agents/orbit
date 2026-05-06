import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { IdentityEditor } from './identity-editor';

describe('IdentityEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the persisted value as the initial draft', () => {
    const { getByPlaceholderText } = render(
      <IdentityEditor value="hello" onSave={() => {}} placeholder="ph" />,
    );
    const ta = getByPlaceholderText('ph') as HTMLTextAreaElement;
    expect(ta.value).toBe('hello');
  });

  it('debounces save: types twice in quick succession, fires onSave once after the timeout', () => {
    const onSave = vi.fn();
    const { getByPlaceholderText } = render(
      <IdentityEditor value="" onSave={onSave} placeholder="ph" debounceMs={500} />,
    );
    const ta = getByPlaceholderText('ph') as HTMLTextAreaElement;

    fireEvent.change(ta, { target: { value: 'h' } });
    vi.advanceTimersByTime(200);
    fireEvent.change(ta, { target: { value: 'hi' } });
    vi.advanceTimersByTime(200);
    fireEvent.change(ta, { target: { value: 'hi!' } });

    // Not enough time has passed since the last keystroke.
    expect(onSave).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('hi!');
  });

  it('does not save when the draft equals the persisted value', () => {
    const onSave = vi.fn();
    render(<IdentityEditor value="same" onSave={onSave} placeholder="ph" debounceMs={500} />);
    vi.advanceTimersByTime(1000);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('external value updates replace the draft only when the user is not editing', () => {
    const onSave = vi.fn();
    const { getByPlaceholderText, rerender } = render(
      <IdentityEditor value="initial" onSave={onSave} placeholder="ph" debounceMs={500} />,
    );
    const ta = getByPlaceholderText('ph') as HTMLTextAreaElement;
    expect(ta.value).toBe('initial');

    // External update with the user not having edited anything: draft adopts.
    rerender(
      <IdentityEditor value="from server" onSave={onSave} placeholder="ph" debounceMs={500} />,
    );
    expect((getByPlaceholderText('ph') as HTMLTextAreaElement).value).toBe('from server');

    // Now the user is mid-edit. An external update should not clobber.
    fireEvent.change(getByPlaceholderText('ph'), { target: { value: 'in flight' } });
    rerender(
      <IdentityEditor
        value="late server update"
        onSave={onSave}
        placeholder="ph"
        debounceMs={500}
      />,
    );
    expect((getByPlaceholderText('ph') as HTMLTextAreaElement).value).toBe('in flight');
  });
});
