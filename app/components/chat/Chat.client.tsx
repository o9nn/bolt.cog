import { useStore } from '@nanostores/react';
import { parseStreamPart, type Message } from 'ai';
import { useChat } from 'ai/react';
import { useAnimate } from 'framer-motion';
import { memo, useEffect, useRef, useState } from 'react';
import { cssTransition, toast, ToastContainer } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts, useSnapScroll } from '~/lib/hooks';
import { useChatHistory } from '~/lib/persistence';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { terminalDiagnosticEnabled, installTerminalDiagnostic } from '~/lib/runtime/desktop-terminal-diagnostic';
import { fileModificationsToHTML } from '~/utils/diff';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

const logger = createScopedLogger('Chat');

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, initialMessages, storeMessageHistory } = useChatHistory();

  return (
    <>
      {ready && <ChatImpl initialMessages={initialMessages} storeMessageHistory={storeMessageHistory} />}
      <ToastContainer
        closeButton={({ closeToast }) => {
          return (
            <button className="Toastify__close-button" onClick={closeToast}>
              <div className="i-ph:x text-lg" />
            </button>
          );
        }}
        icon={({ type }) => {
          /**
           * @todo Handle more types if we need them. This may require extra color palettes.
           */
          switch (type) {
            case 'success': {
              return <div className="i-ph:check-bold text-bolt-elements-icon-success text-2xl" />;
            }
            case 'error': {
              return <div className="i-ph:warning-circle-bold text-bolt-elements-icon-error text-2xl" />;
            }
          }

          return undefined;
        }}
        position="bottom-right"
        pauseOnFocusLoss
        transition={toastAnimation}
      />
    </>
  );
}

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
}

export const ChatImpl = memo(({ initialMessages, storeMessageHistory }: ChatProps) => {
  useShortcuts();

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);

  const { showChat } = useStore(chatStore);
  const [localRuntime, setLocalRuntime] = useState(false);
  const [localTools, setLocalTools] = useState(false);
  const [nativeToolsSupported, setNativeToolsSupported] = useState(false);
  const terminalReceiptCursor = useRef(0);
  const [chatFailure, setChatFailure] = useState<string | undefined>();

  const [animationScope, animate] = useAnimate();

  const { messages, isLoading, input, handleInputChange, setInput, stop, append } = useChat({
    api: '/api/chat',
    body:
      localRuntime && localTools && nativeToolsSupported
        ? { execution: { backend: 'desktop', workspaceId: 'desktop' } }
        : {},
    onError: (error) => {
      logger.error('Request failed\n\n', error);

      let message = error.message || 'Chat failed; inspect the request ID';

      if (message.startsWith('3:')) {
        try {
          const part = parseStreamPart(message.trim().split('\n')[0]);

          if (part.type === 'error') {
            message = part.value;
          }
        } catch {
          message = 'Chat failed; inspect the request ID';
        }
      }

      setChatFailure(message);
      toast.error(message);
    },
    onFinish: () => {
      logger.debug('Finished streaming');
    },
    initialMessages,
  });

  const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
  const { parsedMessages, parseMessages } = useMessageParser();

  useEffect(() => {
    installTerminalDiagnostic();
  }, []);

  useEffect(() => {
    if (terminalDiagnosticEnabled()) {
      (window as any).__boltChatQA = { messages, isLoading, nativeToolsSupported, localTools, error: chatFailure };
    }
  }, [messages, isLoading, nativeToolsSupported, localTools, chatFailure]);

  const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

  useEffect(() => {
    if (window.location.hostname !== '127.0.0.1') {
      return;
    }

    fetch('/api/desktop/info')
      .then((response) => (response.ok ? response.json() : undefined))
      .then((info) => {
        const desktop = typeof info === 'object' && info !== null && 'runtime' in info && info.runtime === 'desktop';
        setLocalRuntime(desktop);
        setNativeToolsSupported(desktop && 'nativeToolsSupported' in info && info.nativeToolsSupported === true);
      })
      .catch(() => setLocalRuntime(false));
  }, []);

  useEffect(() => {
    chatStore.setKey('started', initialMessages.length > 0);
  }, []);

  useEffect(() => {
    parseMessages(messages, isLoading);

    if (messages.length > initialMessages.length) {
      storeMessageHistory(messages).catch((error) => toast.error(error.message));
    }
  }, [messages, isLoading, parseMessages]);

  const scrollTextArea = () => {
    const textarea = textareaRef.current;

    if (textarea) {
      textarea.scrollTop = textarea.scrollHeight;
    }
  };

  const abort = () => {
    stop();
    chatStore.setKey('aborted', true);
    workbenchStore.abortAllActions();
  };

  useEffect(() => {
    const textarea = textareaRef.current;

    if (textarea) {
      textarea.style.height = 'auto';

      const scrollHeight = textarea.scrollHeight;

      textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
      textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
    }
  }, [input, textareaRef]);

  const runAnimation = async () => {
    if (chatStarted) {
      return;
    }

    await Promise.all([
      animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
      animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
    ]);

    chatStore.setKey('started', true);

    setChatStarted(true);
  };

  const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
    const _input = messageInput || input;

    if (_input.length === 0 || isLoading) {
      return;
    }

    /**
     * @note (delm) Usually saving files shouldn't take long but it may take longer if there
     * many unsaved files. In that case we need to block user input and show an indicator
     * of some kind so the user is aware that something is happening. But I consider the
     * happy case to be no unsaved files and I would expect users to save their changes
     * before they send another message.
     */
    await workbenchStore.saveAllFiles();

    const fileModifications = workbenchStore.getFileModifcations();
    const terminalFeedback = workbenchStore.getTerminalFeedback(terminalReceiptCursor.current);
    terminalReceiptCursor.current = terminalFeedback.lastSequence;

    chatStore.setKey('aborted', false);
    setChatFailure(undefined);

    runAnimation();

    if (fileModifications !== undefined) {
      const diff = fileModificationsToHTML(fileModifications);

      /**
       * If we have file modifications we append a new user message manually since we have to prefix
       * the user input with the file modifications and we don't want the new user input to appear
       * in the prompt. Using `append` is almost the same as `handleSubmit` except that we have to
       * manually reset the input and we'd have to manually pass in file attachments. However, those
       * aren't relevant here.
       */
      append({ role: 'user', content: `${diff}\n\n${terminalFeedback.context}${_input}` });

      /**
       * After sending a new message we reset all modifications since the model
       * should now be aware of all the changes.
       */
      workbenchStore.resetAllFileModifications();
    } else {
      append({ role: 'user', content: `${terminalFeedback.context}${_input}` });
    }

    setInput('');

    resetEnhancer();

    textareaRef.current?.blur();
  };

  const [messageRef, scrollRef] = useSnapScroll();

  return (
    <>
      {localRuntime && (
        <label style={{ position: 'fixed', top: 12, right: 120, zIndex: 50, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={localTools}
            disabled={isLoading || !nativeToolsSupported}
            onChange={(event) => setLocalTools(event.target.checked)}
          />{' '}
          Local read-only Agent-Zero tools
          {!nativeToolsSupported && (
            <span title="The selected model's native tool loop is unavailable; closed shell actions still run in the built-in WebContainer terminal">
              {' '}
              — built-in terminal available
            </span>
          )}
        </label>
      )}
      <BaseChat
        ref={animationScope}
        textareaRef={textareaRef}
        input={input}
        showChat={showChat}
        chatStarted={chatStarted}
        isStreaming={isLoading}
        enhancingPrompt={enhancingPrompt}
        promptEnhanced={promptEnhanced}
        sendMessage={sendMessage}
        messageRef={messageRef}
        scrollRef={scrollRef}
        handleInputChange={handleInputChange}
        handleStop={abort}
        messages={messages.map((message, i) => {
          if (message.role === 'user') {
            return message;
          }

          return {
            ...message,
            content: parsedMessages[i] || '',
          };
        })}
        enhancePrompt={() => {
          enhancePrompt(input, (input) => {
            setInput(input);
            scrollTextArea();
          });
        }}
      />
    </>
  );
});
