import React from 'react';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import { FieldState, CODE_MAX_LENGTH } from '../utils/referralCode';
import { REFERRAL_TEXT as T } from '../constants/referralText';

/**
 * Optional referral code on the signup page (spec 5.4). Collapsed to a single
 * "Have a referral code?" link until the customer opens it or arrives with a code.
 * Never shows the sales owner's name.
 */
export default function ReferralCodeField({ open, value, state, ownerName, inputRef, onChange, onBlur, onOpen, onRemove }) {
  if (!open) {
    return (
      <div className="referral-code referral-code--collapsed">
        <button type="button" className="referral-code__link" onClick={onOpen}>
          {T.haveCodeLink}
        </button>
      </div>
    );
  }

  const tone =
    state === FieldState.VALID ? 'valid'
      : state === FieldState.INVALID || state === FieldState.INACTIVE ? 'invalid'
        : '';

  let message = null;
  let withRemove = false;
  switch (state) {
    case FieldState.CHECKING:
      message = (
        <span className="referral-code__msg referral-code__msg--checking">
          <Loader2 size={14} className="referral-code__spin" /> {T.checking}
        </span>
      );
      break;
    case FieldState.VALID:
      message = (
        <span className="referral-code__msg referral-code__msg--valid">
          <CheckCircle2 size={14} /> {T.valid}
          {ownerName ? <span className="referral-code__owner">{T.referredBy} {ownerName}</span> : null}
        </span>
      );
      break;
    case FieldState.INVALID:
      message = <span className="referral-code__msg referral-code__msg--invalid">{T.invalid}</span>;
      withRemove = true;
      break;
    case FieldState.INACTIVE:
      message = <span className="referral-code__msg referral-code__msg--invalid">{T.inactive}</span>;
      withRemove = true;
      break;
    case FieldState.CHECK_FAILED:
      message = <span className="referral-code__msg referral-code__msg--warn">{T.checkFailed}</span>;
      break;
    default:
      message = null;
  }

  return (
    <div className="referral-code form-group">
      <label htmlFor="referral-code-input">
        {T.label} <span className="referral-code__optional">{T.optional}</span>
      </label>
      <div className={`referral-code__control ${tone ? `referral-code__control--${tone}` : ''}`}>
        <input
          id="referral-code-input"
          ref={inputRef}
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={CODE_MAX_LENGTH}
          value={value}
          placeholder={T.placeholder}
          aria-invalid={tone === 'invalid'}
          aria-describedby="referral-code-status"
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
        {value ? (
          <button type="button" className="referral-code__clear" aria-label={T.clearAria} onClick={onRemove}>
            <X size={14} />
          </button>
        ) : null}
      </div>
      <div id="referral-code-status" className="referral-code__status" aria-live="polite">
        {message}
        {withRemove ? (
          <button type="button" className="referral-code__remove" onClick={onRemove}>
            {T.removeCode}
          </button>
        ) : null}
      </div>
    </div>
  );
}
