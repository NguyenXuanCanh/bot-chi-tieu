import { useCallback, useEffect, useState } from 'react';

/** Tải dữ liệu khi `key` đổi; trả về data/error/loading và hàm reload. Bỏ kết quả của request cũ. */
export function useApi<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    load()
      .then((data) => alive && setState({ data, loading: false }))
      .catch((e: Error) => alive && setState((s) => ({ data: s.data, error: e.message, loading: false })));
    return () => {
      alive = false;
    };
    // `load` đổi theo mỗi lần render; chỉ tải lại khi key hoặc nonce đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: undefined }));
    setNonce((n) => n + 1);
  }, []);
  return { ...state, reload };
}
