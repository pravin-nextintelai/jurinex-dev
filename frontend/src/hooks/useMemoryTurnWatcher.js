import { useEffect, useRef } from 'react';
import memoryApi from '../services/memoryApi';
import { CASE_CHAT_DONE_EVENT } from '../utils/memoryLabels';

/**
 * Report what memory did after each answer in this case.
 *
 * The case chat fires CASE_CHAT_DONE_EVENT once an answer is delivered. The
 * memory writer runs after that (one short model call, plus filling the case in
 * from its details the first time), so its result is polled a few times and
 * then left alone. `onTurn` receives the finished turn.
 */
const POLL_DELAYS_MS = [2500, 3500, 5000, 8000, 12000];

const sameFolder = (a, b) => {
  const left = String(a || '').trim();
  return left !== '' && left === String(b || '').trim();
};

export default function useMemoryTurnWatcher(folderName, { enabled = true, onTurn } = {}) {
  const onTurnRef = useRef(onTurn);

  useEffect(() => {
    onTurnRef.current = onTurn;
  }, [onTurn]);

  useEffect(() => {
    if (!enabled || !folderName) return undefined;
    const timers = new Set();
    let stopped = false;

    const check = (chatId, attempt) => {
      const timer = window.setTimeout(async () => {
        timers.delete(timer);
        if (stopped) return;
        let turn = null;
        try {
          turn = await memoryApi.getTurn(folderName, chatId);
        } catch {
          return; // No access, or the service is unreachable: nothing to report.
        }
        if (stopped) return;
        if (turn?.ready) {
          onTurnRef.current?.(turn);
        } else if (attempt + 1 < POLL_DELAYS_MS.length) {
          check(chatId, attempt + 1);
        }
      }, POLL_DELAYS_MS[attempt]);
      timers.add(timer);
    };

    const handleDone = (event) => {
      const { folderName: chatFolder, chatId } = event?.detail || {};
      if (chatId && sameFolder(chatFolder, folderName)) check(chatId, 0);
    };

    window.addEventListener(CASE_CHAT_DONE_EVENT, handleDone);
    return () => {
      stopped = true;
      window.removeEventListener(CASE_CHAT_DONE_EVENT, handleDone);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [enabled, folderName]);
}
