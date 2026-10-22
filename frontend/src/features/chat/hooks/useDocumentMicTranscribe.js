import { useCallback, useEffect, useRef, useState } from 'react';
import { transcribeMicAudio } from '../utils/micTranscribe';

/**
 * Record mic audio → POST to agentic STT → return verbatim transcript.
 * Caller puts transcript in the chat input; user sends the prompt manually.
 */
export function useDocumentMicTranscribe(serviceBaseUrl, { onTranscript, onError } = {}) {
  const [micStatus, setMicStatus] = useState('idle'); // idle | recording | transcribing
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const startRecording = useCallback(async () => {
    if (micStatus !== 'idle') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data?.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        cleanupStream();
        mediaRecorderRef.current = null;
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];

        if (!blob.size) {
          setMicStatus('idle');
          return;
        }

        setMicStatus('transcribing');
        try {
          const { transcript } = await transcribeMicAudio(blob, mimeType, serviceBaseUrl);
          onTranscript?.(transcript);
        } catch (err) {
          onError?.(err);
        } finally {
          setMicStatus('idle');
        }
      };

      recorder.start();
      setMicStatus('recording');
    } catch (err) {
      cleanupStream();
      setMicStatus('idle');
      onError?.(err);
    }
  }, [micStatus, serviceBaseUrl, cleanupStream, onTranscript, onError]);

  const toggleMic = useCallback(() => {
    if (micStatus === 'recording') stopRecording();
    else if (micStatus === 'idle') startRecording();
  }, [micStatus, stopRecording, startRecording]);

  useEffect(() => () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch (_) {
        /* ignore */
      }
    }
    cleanupStream();
  }, [cleanupStream]);

  return { micStatus, toggleMic, isRecording: micStatus === 'recording', isTranscribing: micStatus === 'transcribing' };
}
