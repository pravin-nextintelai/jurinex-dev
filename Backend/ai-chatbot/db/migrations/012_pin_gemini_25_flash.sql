-- Pin text chat to gemini-2.5-flash and clear retired model names left in the
-- chatbot_config row by the original schema. A retired model_text
-- (gemini-1.5-flash) made every /api/chat call fail with
-- "404 NOT_FOUND: models/gemini-1.5-flash is not found for API version v1beta".
-- The code (app/services/chatbot.py) also enforces this, so the row can no longer
-- switch text chat to another model.

ALTER TABLE chatbot_config ALTER COLUMN model_text  SET DEFAULT 'gemini-2.5-flash';
ALTER TABLE chatbot_config ALTER COLUMN model_audio SET DEFAULT 'gemini-3.1-flash-live-preview';

UPDATE chatbot_config
   SET model_text = 'gemini-2.5-flash', updated_at = NOW()
 WHERE config_key = 'default'
   AND model_text IS DISTINCT FROM 'gemini-2.5-flash';

UPDATE chatbot_config
   SET model_audio = 'gemini-3.1-flash-live-preview', updated_at = NOW()
 WHERE config_key = 'default'
   AND model_audio IN (
       'gemini-2.0-flash-live',
       'gemini-2.0-flash-live-001',
       'gemini-1.5-flash',
       'gemini-2.5-flash-native-audio-latest',
       'models/gemini-2.5-flash-native-audio-latest'
   );
