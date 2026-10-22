// import { useState, useRef, useCallback, useEffect } from 'react';
// import { convertJsonToPlainText } from '@/shared/utils/jsonToPlainText';
// import { renderSecretPromptResponse, isStructuredJsonResponse } from '@/shared/utils/renderSecretPromptResponse';
// import { DOCS_BASE_URL } from '@/config/apiConfig';

// const API_BASE = DOCS_BASE_URL;

// const getAuthToken = () => {
//   const tokenKeys = [
//     'authToken',
//     'token',
//     'accessToken',
//     'jwt',
//     'bearerToken',
//     'auth_token',
//     'access_token',
//     'api_token',
//     'userToken',
//   ];
//   for (const key of tokenKeys) {
//     const token = localStorage.getItem(key);
//     if (token) return token;
//   }
//   return null;
// };

// export function useIntelligentFolderChat(folderName, authToken = null) {
//   const [text, setText] = useState('');
//   const [thinking, setThinking] = useState('');
//   const [isStreaming, setIsStreaming] = useState(false);
//   const [error, setError] = useState(null);
//   const [sessionId, setSessionId] = useState(null);
//   const [methodUsed, setMethodUsed] = useState(null);
//   const [routingDecision, setRoutingDecision] = useState(null);
//   const [status, setStatus] = useState(null);
//   const [finalMetadata, setFinalMetadata] = useState(null);

//   const abortControllerRef = useRef(null);
//   const updateTimeoutRef = useRef(null);

//   const sendMessage = useCallback(async (question, secretId = null) => {
//     if (abortControllerRef.current) {
//       abortControllerRef.current.abort();
//     }

//     abortControllerRef.current = new AbortController();
//     const signal = abortControllerRef.current.signal;

//     setText('');
//     setThinking('');
//     setError(null);
//     setIsStreaming(true);
//     setMethodUsed(null);
//     setRoutingDecision(null);
//     setStatus(null);

//     if (updateTimeoutRef.current) {
//       clearTimeout(updateTimeoutRef.current);
//       updateTimeoutRef.current = null;
//     }

//     try {
//       const token = authToken || getAuthToken();
//       const endpoint = `${API_BASE}/${folderName}/intelligent-chat/stream`;

//       const requestBody = {
//         session_id: sessionId,
//         llm_name: 'gemini',
//       };

//       if (secretId) {
//         requestBody.secret_id = secretId;
//       } else if (question && question.trim()) {
//         requestBody.question = question.trim();
//       } else {
//         setError('Please enter a question or select an analysis prompt.');
//         setIsStreaming(false);
//         return;
//       }

//       const response = await fetch(endpoint, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           'Authorization': token ? `Bearer ${token}` : '',
//           'Accept': 'text/event-stream',
//         },
//         body: JSON.stringify(requestBody),
//         signal,
//       });

//       if (!response.ok) {
//         const errorData = await response.json().catch(() => ({}));
//         const errorMessage = errorData.error || errorData.message || `HTTP ${response.status}`;
        
//         if (secretId && errorMessage.toLowerCase().includes('question') && errorMessage.toLowerCase().includes('required')) {
//           setError('Backend error: Secret prompt could not be processed. Please try again or contact support.');
//         } else {
//           setError(errorMessage);
//         }
//         setIsStreaming(false);
//         return;
//       }

//       const reader = response.body.getReader();
//       const decoder = new TextDecoder();
//       let lineBuffer = '';
//       let accumulatedText = '';
//       let accumulatedThinking = '';
//       const isUsingSecretId = !!secretId;

//       while (true) {
//         if (signal.aborted) {
//           setIsStreaming(false);
//           break;
//         }

//         const { done, value } = await reader.read();

//         if (done) {
//           setIsStreaming(false);
//           if (accumulatedText) {
//             const isStructured = isStructuredJsonResponse(accumulatedText);
//             const formattedResponse = isStructured
//               ? renderSecretPromptResponse(accumulatedText)
//               : convertJsonToPlainText(accumulatedText);
//             setText(formattedResponse);
//           }
//           if (accumulatedThinking) {
//             setThinking(accumulatedThinking);
//           }
//           break;
//         }

//         lineBuffer += decoder.decode(value, { stream: true });
//         const lines = lineBuffer.split('\n');
//         lineBuffer = lines.pop() || '';

//         for (const line of lines) {
//           if (!line.trim() || !line.startsWith('data: ')) continue;

//           const data = line.replace(/^data: /, '').trim();

//           if (data === '[PING]') continue;

//           if (data === '[DONE]') {
//             setIsStreaming(false);
//             if (accumulatedText) {
//               const isStructured = isStructuredJsonResponse(accumulatedText);
//               const formattedResponse = isStructured
//                 ? renderSecretPromptResponse(accumulatedText)
//                 : convertJsonToPlainText(accumulatedText);
//               setText(formattedResponse);
//             }
//             if (accumulatedThinking) {
//               setThinking(accumulatedThinking);
//             }
//             return;
//           }

//           try {
//             const parsed = JSON.parse(data);

//             switch (parsed.type) {
//               case 'metadata':
//                 if (parsed.session_id) {
//                   setSessionId(parsed.session_id);
//                 }
//                 if (parsed.method) {
//                   setMethodUsed(parsed.method);
//                 }
//                 if (parsed.routing_decision) {
//                   setRoutingDecision(parsed.routing_decision);
//                 }
//                 break;

//               case 'status':
//                 setStatus({
//                   status: parsed.status,
//                   message: parsed.message,
//                 });
//                 break;

//               case 'thinking':
//                 const thinkingText = parsed.text || '';
//                 if (thinkingText) {
//                   accumulatedThinking += thinkingText;
                  
//                   if (updateTimeoutRef.current) {
//                     clearTimeout(updateTimeoutRef.current);
//                   }
                  
//                   updateTimeoutRef.current = setTimeout(() => {
//                     setThinking(accumulatedThinking);
//                     updateTimeoutRef.current = null;
//                   }, 10);
//                 }
//                 break;

//               case 'chunk':
//                 const chunkText = parsed.text || '';
//                 if (chunkText) {
//                   accumulatedText += chunkText;
//                 }
//                 break;

//               case 'done':
//                 setIsStreaming(false);
//                 if (parsed.session_id) setSessionId(parsed.session_id);
//                 if (parsed.method) setMethodUsed(parsed.method);
//                 if (parsed.routing_decision) {
//                   setRoutingDecision(parsed.routing_decision);
//                 }
//                 setFinalMetadata(parsed);
//                 console.log('[useIntelligentFolderChat] Done metadata:', parsed);
//                 console.log('[useIntelligentFolderChat] used_chunk_ids:', parsed.used_chunk_ids);
//                 console.log('[useIntelligentFolderChat] citations:', parsed.citations);
//                 if (accumulatedText) {
//                   const isStructured = isStructuredJsonResponse(accumulatedText);
//                   const formattedResponse = isStructured
//                     ? renderSecretPromptResponse(accumulatedText)
//                     : convertJsonToPlainText(accumulatedText);
//                   setText(formattedResponse);
//                 }
//                 if (accumulatedThinking) {
//                   setThinking(accumulatedThinking);
//                 }
//                 break;

//               case 'error':
//                 const errorMsg = parsed.message || parsed.error || 'An error occurred';
//                 if (isUsingSecretId && errorMsg.toLowerCase().includes('question') && errorMsg.toLowerCase().includes('required')) {
//                   setError('Backend error: Secret prompt could not be processed. Please try again or contact support.');
//                 } else {
//                   setError(errorMsg);
//                 }
//                 setIsStreaming(false);
//                 break;

//               default:
//                 console.log('Unknown stream event type:', parsed.type);
//             }
//           } catch (e) {
//             console.warn('Failed to parse stream data:', e, data);
//           }
//         }
//       }
//     } catch (err) {
//       if (err.name === 'AbortError') {
//         console.log('Request aborted');
//         setIsStreaming(false);
//         return;
//       }
//       setError(err.message || 'An error occurred');
//       setIsStreaming(false);
//     } finally {
//       if (updateTimeoutRef.current) {
//         clearTimeout(updateTimeoutRef.current);
//         updateTimeoutRef.current = null;
//       }
//     }
//   }, [folderName, authToken, sessionId]);

//   const stopStreaming = useCallback(() => {
//     if (abortControllerRef.current) {
//       abortControllerRef.current.abort();
//       abortControllerRef.current = null;
//     }
//     setIsStreaming(false);
//   }, []);

//   const clear = useCallback(() => {
//     setText('');
//     setThinking('');
//     setError(null);
//     setMethodUsed(null);
//     setRoutingDecision(null);
//     setStatus(null);
//     stopStreaming();
//   }, [stopStreaming]);

//   useEffect(() => {
//     return () => {
//       if (abortControllerRef.current) {
//         abortControllerRef.current.abort();
//       }
//       if (updateTimeoutRef.current) {
//         clearTimeout(updateTimeoutRef.current);
//       }
//     };
//   }, []);

//   return {
//     text,
//     thinking,
//     isStreaming,
//     error,
//     sessionId,
//     methodUsed,
//     routingDecision,
//     status,
//     finalMetadata,
//     sendMessage,
//     stopStreaming,
//     clear,
//   };
// }

import { useState, useRef, useCallback, useEffect } from 'react';
import { convertJsonToPlainText } from '@/shared/utils/jsonToPlainText';
import { renderSecretPromptResponse, isStructuredJsonResponse } from '@/shared/utils/renderSecretPromptResponse';
import { DOCS_BASE_URL } from '@/config/apiConfig';
import { parseLlmPolicyErrorForUi, stringToChatErrorDisplay } from '@/shared/utils/llmQuotaMessages';
import { notifyResponseComplete, ensureNotificationPermission } from '@/shared/utils/responseNotifier';
import {
  mergeResearchStreamChunk,
  reconcileDeepResearchStreamText,
} from '../utils/deepResearchSources';

const API_BASE = DOCS_BASE_URL;

const getAuthToken = () => {
  const tokenKeys = [
    'authToken',
    'token',
    'accessToken',
    'jwt',
    'bearerToken',
    'auth_token',
    'access_token',
    'api_token',
    'userToken',
  ];
  for (const key of tokenKeys) {
    const token = localStorage.getItem(key);
    if (token) return token;
  }
  return null;
};

export function useIntelligentFolderChat(folderName, authToken = null) {
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [methodUsed, setMethodUsed] = useState(null);
  const [routingDecision, setRoutingDecision] = useState(null);
  const [status, setStatus] = useState(null);
  const [finalMetadata, setFinalMetadata] = useState(null);
  const [learningPayload, setLearningPayload] = useState(null);
  const [learningPopupQuestion, setLearningPopupQuestion] = useState(null);

  const abortControllerRef = useRef(null);
  const updateTimeoutRef = useRef(null);
  const chunkDisplayTimeoutRef = useRef(null);

  // Mint a conversation id on the CLIENT, before the request goes out.
  //
  // Previously `sessionId` stayed null for a brand-new chat and was only learned from
  // the server's `metadata` SSE event — which arrives at the very END of the stream. So
  // if the user opened another chat while the answer was still streaming, the client had
  // no id for the conversation it just abandoned: it vanished from the UI, and there was
  // nothing to navigate back to. Generating the id up-front (the same thing ChatGPT and
  // Claude do) makes the conversation addressable from the first token, so switching away
  // and back lands in the same session. The backend already honours a supplied id —
  // `_get_or_create_session` uses `id=key or uuid4()`.
  const newSessionId = () => {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch { /* fall through to the manual builder below */ }
    // RFC-4122 v4 fallback for older browsers / non-secure origins where randomUUID is absent.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  const formatAssistantText = (raw) => {
    if (!raw) return '';
    try {
      const isStructured = isStructuredJsonResponse(raw);
      return isStructured ? renderSecretPromptResponse(raw) : convertJsonToPlainText(raw);
    } catch (e) {
      console.warn('[useIntelligentFolderChat] formatAssistantText failed, using raw text', e);
      return raw;
    }
  };

  const sendMessage = useCallback(async (question, secretId = null, streamOpts = null) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setText('');
    setThinking('');
    setError(null);
    setIsStreaming(true);
    setMethodUsed(null);
    setRoutingDecision(null);
    setStatus(null);
    setFinalMetadata(null);
    setLearningPayload(null);
    setLearningPopupQuestion(null);

    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = null;
    }

    try {
      ensureNotificationPermission();
      const token = authToken || getAuthToken();
      const endpoint = `${API_BASE}/${encodeURIComponent(folderName)}/intelligent-chat/stream`;

      // Reuse the active conversation's id, else mint one NOW so this chat is
      // addressable from the first token rather than only after the stream ends.
      const effectiveSessionId = sessionId || newSessionId();
      if (effectiveSessionId !== sessionId) setSessionId(effectiveSessionId);

      const requestBody = {
        session_id: effectiveSessionId,
        llm_name: 'gemini',
      };
      if (streamOpts && typeof streamOpts === 'object') {
        if (streamOpts.session_id) requestBody.session_id = streamOpts.session_id;
        if (streamOpts.llm_name) requestBody.llm_name = streamOpts.llm_name;
        if (streamOpts.max_output_tokens != null && streamOpts.max_output_tokens !== '') {
          const n = Number(streamOpts.max_output_tokens);
          if (Number.isFinite(n)) requestBody.max_output_tokens = n;
        }
        if (streamOpts.model_temperature != null && streamOpts.model_temperature !== '') {
          const t = Number(streamOpts.model_temperature);
          if (Number.isFinite(t)) requestBody.model_temperature = t;
        }
        if (streamOpts.learning_mode != null) {
          requestBody.learning_mode = !!streamOpts.learning_mode;
        }
        if (streamOpts.research_mode != null) {
          requestBody.research_mode = !!streamOpts.research_mode;
        }
        if (streamOpts.deep_research != null) {
          requestBody.deep_research = !!streamOpts.deep_research;
        }
        if (streamOpts.adversarial_mode != null) {
          requestBody.adversarial_mode = !!streamOpts.adversarial_mode;
        }
        if (streamOpts.context_page != null && streamOpts.context_page !== '') {
          const p = Number(streamOpts.context_page);
          if (Number.isFinite(p)) requestBody.context_page = p;
        }
        if (streamOpts.context_selection) {
          requestBody.context_selection = String(streamOpts.context_selection);
        }
        if (streamOpts.document_context) {
          requestBody.document_context = String(streamOpts.document_context);
        }
      }

      if (secretId) {
        requestBody.secret_id = secretId;
      } else if (question && question.trim()) {
        const rawQuestion = question.trim();
        const learningModeOn = !!requestBody.learning_mode;
        const englishOnlySuffix =
          '\n\nRespond in clear professional English only. Do not switch language.';
        requestBody.question = learningModeOn ? `${rawQuestion}${englishOnlySuffix}` : rawQuestion;
      } else {
        setError(stringToChatErrorDisplay('Please enter a question or select an analysis prompt.'));
        setIsStreaming(false);
        return;
      }

      const isDeepResearchRequest = requestBody.deep_research === true;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(requestBody),
        signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const display = parseLlmPolicyErrorForUi(response.status, errorData);
        const errorMessage = display.body || '';
        if (
          secretId &&
          errorMessage.toLowerCase().includes('question') &&
          errorMessage.toLowerCase().includes('required')
        ) {
          setError(
            stringToChatErrorDisplay(
              'Backend error: Secret prompt could not be processed. Please try again or contact support.'
            )
          );
        } else {
          setError(display);
        }
        setIsStreaming(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = '';
      let accumulatedText = '';
      let accumulatedThinking = '';
      const isUsingSecretId = !!secretId;

      while (true) {
        if (signal.aborted) {
          setIsStreaming(false);
          break;
        }

        const { done, value } = await reader.read();

        if (done) {
          setIsStreaming(false);
          if (chunkDisplayTimeoutRef.current) {
            clearTimeout(chunkDisplayTimeoutRef.current);
            chunkDisplayTimeoutRef.current = null;
          }
          if (accumulatedText) {
            setText(isDeepResearchRequest ? accumulatedText : formatAssistantText(accumulatedText));
          }
          if (accumulatedThinking) {
            setThinking(accumulatedThinking);
          }
          break;
        }

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split(/\r\n|\n|\r/);
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;

          const data = line.replace(/^data: /, '').trim();

          if (data === '[PING]') continue;

          if (data === '[DONE]') {
            setIsStreaming(false);
            if (chunkDisplayTimeoutRef.current) {
              clearTimeout(chunkDisplayTimeoutRef.current);
              chunkDisplayTimeoutRef.current = null;
            }
            if (accumulatedText) {
              setText(isDeepResearchRequest ? accumulatedText : formatAssistantText(accumulatedText));
            }
            if (accumulatedThinking) {
              setThinking(accumulatedThinking);
            }
            return;
          }

          try {
            const parsed = JSON.parse(data);

            switch (parsed.type) {
              case 'metadata':
                if (parsed.session_id) {
                  setSessionId(parsed.session_id);
                }
                if (parsed.method) {
                  setMethodUsed(parsed.method);
                }
                if (parsed.routing_decision) {
                  setRoutingDecision(parsed.routing_decision);
                }
                break;

              case 'status':
                setStatus({
                  status: parsed.status,
                  message: parsed.message,
                });
                break;

              case 'thinking': {
                const thinkingText = parsed.text || '';
                if (thinkingText) {
                  accumulatedThinking += thinkingText;

                  if (updateTimeoutRef.current) {
                    clearTimeout(updateTimeoutRef.current);
                  }

                  updateTimeoutRef.current = setTimeout(() => {
                    setThinking(accumulatedThinking);
                    updateTimeoutRef.current = null;
                  }, 10);
                }
                break;
              }

              case 'chunk': {
                const chunkText = parsed.text || '';
                const replaceDeepSnapshot = isDeepResearchRequest && parsed.replace === true;
                if (chunkText || replaceDeepSnapshot) {
                  accumulatedText = mergeResearchStreamChunk(
                    accumulatedText,
                    chunkText,
                    isDeepResearchRequest,
                    parsed.replace,
                  );
                  if (chunkDisplayTimeoutRef.current) {
                    clearTimeout(chunkDisplayTimeoutRef.current);
                    chunkDisplayTimeoutRef.current = null;
                  }
                  setText(accumulatedText);
                }
                break;
              }

              case 'done':
                setIsStreaming(false);
                notifyResponseComplete();
                if (chunkDisplayTimeoutRef.current) {
                  clearTimeout(chunkDisplayTimeoutRef.current);
                  chunkDisplayTimeoutRef.current = null;
                }
                if (parsed.session_id) setSessionId(parsed.session_id);
                if (parsed.method) setMethodUsed(parsed.method);
                if (parsed.routing_decision) {
                  setRoutingDecision(parsed.routing_decision);
                }
                setFinalMetadata(parsed);
                if (parsed.learning_payload) {
                  setLearningPayload(parsed.learning_payload);
                }
                if (parsed.learning_popup_question && typeof parsed.learning_popup_question === 'object') {
                  setLearningPopupQuestion(parsed.learning_popup_question);
                } else {
                  setLearningPopupQuestion(null);
                }
                console.log('[useIntelligentFolderChat] Done metadata:', parsed);
                console.log('[useIntelligentFolderChat] used_chunk_ids:', parsed.used_chunk_ids);
                console.log('[useIntelligentFolderChat] citations:', parsed.citations);
                {
                  // Prefer the backend's `done.answer` unconditionally (not just when
                  // longer): it's the normalized, persisted text — e.g. Research/Deep
                  // Research resolve grounding-redirect source links to their real
                  // destination as a final step, which can make `answer` SHORTER than the
                  // raw streamed buffer (dead links are dropped, not just swapped). A
                  // length-based fallback would silently prefer the stale, dead-link text.
                  const hasDoneAnswer = typeof parsed.answer === 'string';
                  const fromDone = hasDoneAnswer ? parsed.answer : '';
                  if (isDeepResearchRequest && hasDoneAnswer) {
                    // Keep the final server-validated answer as the stream buffer too,
                    // so a following [DONE]/EOF cannot restore transient link text.
                    accumulatedText = reconcileDeepResearchStreamText(accumulatedText, fromDone);
                  }
                  const raw = isDeepResearchRequest && hasDoneAnswer
                    ? accumulatedText
                    : fromDone || accumulatedText;
                  if (raw || (isDeepResearchRequest && hasDoneAnswer)) {
                    setText(isDeepResearchRequest ? raw : formatAssistantText(raw));
                  }
                }
                if (accumulatedThinking) {
                  setThinking(accumulatedThinking);
                }
                break;

              case 'error': {
                const errorMsg = parsed.message || parsed.error || 'An error occurred';
                if (
                  isUsingSecretId &&
                  errorMsg.toLowerCase().includes('question') &&
                  errorMsg.toLowerCase().includes('required')
                ) {
                  setError(
                    stringToChatErrorDisplay(
                      'Backend error: Secret prompt could not be processed. Please try again or contact support.'
                    )
                  );
                } else {
                  setError(stringToChatErrorDisplay(errorMsg));
                }
                setIsStreaming(false);
                break;
              }

              default:
                console.log('Unknown stream event type:', parsed.type);
            }
          } catch (e) {
            console.warn('Failed to parse stream data:', e, data);
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Request aborted');
        setIsStreaming(false);
        return;
      }
      setError(stringToChatErrorDisplay(err.message || 'An error occurred'));
      setIsStreaming(false);
    } finally {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = null;
      }
      if (chunkDisplayTimeoutRef.current) {
        clearTimeout(chunkDisplayTimeoutRef.current);
        chunkDisplayTimeoutRef.current = null;
      }
    }
  }, [folderName, authToken, sessionId]);

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const clear = useCallback(() => {
    setText('');
    setThinking('');
    setError(null);
    setMethodUsed(null);
    setRoutingDecision(null);
    setStatus(null);
    setLearningPayload(null);
    setLearningPopupQuestion(null);
    stopStreaming();
  }, [stopStreaming]);

  const dismissLearningPopup = useCallback(() => {
    setLearningPopupQuestion(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      if (chunkDisplayTimeoutRef.current) {
        clearTimeout(chunkDisplayTimeoutRef.current);
      }
    };
  }, []);

  return {
    text,
    thinking,
    isStreaming,
    error,
    sessionId,
    methodUsed,
    routingDecision,
    status,
    finalMetadata,
    learningPayload,
    learningPopupQuestion,
    dismissLearningPopup,
    sendMessage,
    stopStreaming,
    clear,
    clearError,
  };
}
