"use client";
import { useEffect, useRef, useState } from "react";
import {
  errorText,
  isDefinitiveWorkflowFailure,
  requestId,
  WorkflowError,
} from "./workflow";

// An unknown response may follow a committed transaction. Keep its exact payload
// and ID until replay confirms the outcome; never generate a second mutation.
export function useCandidateAction(onSuccess: () => Promise<void> | void) {
  const mounted = useRef(true),
    running = useRef(false);
  const pending = useRef<null | (() => Promise<unknown>)>(null);
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [conflict, setConflict] = useState(false);
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current = null;
    };
  }, []);
  async function execute() {
    if (running.current || !pending.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await pending.current();
      if (!mounted.current) return;
      pending.current = null;
      setUncertain(false);
      setMessage("Action confirmed.");
      await onSuccess();
    } catch (e) {
      if (!mounted.current) return;
      setError(errorText(e));
      if (isDefinitiveWorkflowFailure(e)) {
        pending.current = null;
        setUncertain(false);
        if (e instanceof WorkflowError && e.code === "conflict")
          setConflict(true);
      } else if (pending.current) setUncertain(true);
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function run<T extends object>(
    input: T,
    send: (input: T & { requestId: string }) => Promise<unknown>,
  ) {
    if (running.current || pending.current || conflict) return;
    const snapshot = { ...input, requestId: requestId() };
    pending.current = () => send(snapshot);
    void execute();
  }
  return {
    run,
    retry: () => void execute(),
    busy,
    uncertain,
    conflict,
    error,
    message,
    locked: busy || uncertain,
    reconciled: () => {
      if (!pending.current) setConflict(false);
    },
  };
}
