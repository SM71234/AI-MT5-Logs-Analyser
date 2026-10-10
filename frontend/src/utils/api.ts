/**
 * Resiliently parses JSON from HTTP responses, providing user-friendly
 * start-up messages when the backend is loading or unreachable.
 */
export const safeJsonParse = async (res: Response): Promise<any> => {
  const contentType = res.headers.get('Content-Type');
  if (!contentType || !contentType.includes('application/json')) {
    if (res.status >= 500) {
      throw new Error(`Server is starting up or temporarily offline (status ${res.status}). Please try again in a few seconds.`);
    }
    
    // Gateway errors (502/504) returned by Vite proxy will often have empty or HTML text
    if (res.status === 504 || res.status === 502) {
      throw new Error('Backend server is starting up. Please wait 5-10 seconds and try again...');
    }

    try {
      const text = await res.text();
      if (!text || text.trim() === '') {
        throw new Error(`Server returned empty response (status ${res.status}). It might be starting up.`);
      }
    } catch {
      // Ignore text read error
    }
    throw new Error(`Unexpected server response format (status ${res.status}).`);
  }
  
  try {
    return await res.json();
  } catch (e) {
    throw new Error('Server returned invalid JSON format. It might be starting up.');
  }
};
