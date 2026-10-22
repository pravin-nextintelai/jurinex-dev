/**
 * Referral code field behaviour for the signup page (spec section 5).
 *
 *   const referral = useReferralCode();
 *   <ReferralCodeField {...referral.fieldProps} />
 *   const decision = await referral.resolveForSubmit();   // { allowed, referralCode }
 *   referral.onSignupSuccess();                            // clears jx_referral
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { checkReferralCode } from '../api/salesReferrals.api';
import {
  CODE_MIN_LENGTH,
  FieldState,
  clearStoredReferral,
  createLatestGuard,
  normalizeInput,
  resolveInitialReferral,
  stateForValue,
  stateFromStatus,
  submitDecision,
} from '../utils/referralCode';

const DEBOUNCE_MS = 400;

function storage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function session() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export default function useReferralCode() {
  const location = useLocation();
  const initial = useMemo(
    () => resolveInitialReferral({ search: location.search, hash: typeof window !== 'undefined' ? window.location.hash : '', storage: storage(), session: session() }),
    // the URL code is read once, when the page opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [open, setOpen] = useState(Boolean(initial.code));
  const [value, setValue] = useState(initial.code);
  const [state, setState] = useState(initial.code ? FieldState.CHECKING : FieldState.HIDDEN);
  const [checkedValue, setCheckedValue] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const guard = useRef(createLatestGuard());
  const timer = useRef(null);
  const inFlight = useRef(null); // promise of the latest check
  const inputRef = useRef(null);

  const check = useCallback((raw) => {
    const code = normalizeInput(raw);
    if (code.length < CODE_MIN_LENGTH) return Promise.resolve(null);
    const id = guard.current.next();
    setState(FieldState.CHECKING);
    const p = checkReferralCode(code)
      .then(({ status, ownerName: name }) => {
        if (!guard.current.isLatest(id)) return null;
        const next = stateFromStatus(status);
        setState(next);
        setOwnerName(next === FieldState.VALID ? name || '' : '');
        setCheckedValue(code);
        return next;
      })
      .catch((err) => {
        if (!guard.current.isLatest(id) || (err && err.code === 'ABORTED')) return null;
        setState(FieldState.CHECK_FAILED);
        setOwnerName('');
        setCheckedValue(code);
        return FieldState.CHECK_FAILED;
      });
    inFlight.current = p;
    return p;
  }, []);

  // A code from the link or from memory is checked at once.
  useEffect(() => {
    if (initial.code) check(initial.code);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChange = useCallback((raw) => {
    const code = normalizeInput(raw);
    setValue(code);
    setCheckedValue('');
    setOwnerName('');
    if (timer.current) clearTimeout(timer.current);
    const immediate = stateForValue(code, true);
    if (immediate) {
      guard.current.next(); // drop any in-flight answer for an older value
      setState(immediate);
      return;
    }
    setState(FieldState.CHECKING);
    timer.current = setTimeout(() => check(code), DEBOUNCE_MS);
  }, [check]);

  const onBlur = useCallback(() => {
    const code = normalizeInput(value);
    if (code.length >= CODE_MIN_LENGTH && checkedValue !== code) {
      if (timer.current) clearTimeout(timer.current);
      check(code);
    }
  }, [value, checkedValue, check]);

  const openField = useCallback(() => {
    setOpen(true);
    setState(FieldState.EMPTY);
    setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
  }, []);

  const removeCode = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    guard.current.next();
    setValue('');
    setCheckedValue('');
    setOwnerName('');
    setOpen(true);
    setState(FieldState.EMPTY);
    clearStoredReferral(storage());
    clearStoredReferral(session());
    setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
  }, []);

  /** Called on Sign Up: waits for an in-flight check, then applies the submit rules. */
  const resolveForSubmit = useCallback(async () => {
    let current = state;
    if (current === FieldState.CHECKING) {
      if (timer.current) {
        clearTimeout(timer.current);
        await check(value);
      }
      const settled = inFlight.current ? await inFlight.current : null;
      current = settled || FieldState.CHECK_FAILED;
    }
    const decision = submitDecision(current, value);
    if (!decision.allowed) {
      setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
    }
    return decision;
  }, [state, value, check]);

  const onSignupSuccess = useCallback(() => {
    clearStoredReferral(storage());
    clearStoredReferral(session());
  }, []);

  return {
    open,
    value,
    state,
    ownerName,
    fieldProps: { open, value, state, ownerName, inputRef, onChange, onBlur, onOpen: openField, onRemove: removeCode },
    resolveForSubmit,
    onSignupSuccess,
  };
}
