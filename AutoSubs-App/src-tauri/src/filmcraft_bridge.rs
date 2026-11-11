//! Client for FilmCraft's authenticated, loopback JSON-lines control channel.

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::time::{Duration, timeout};

const PORT: u16 = 9876;
const MAX_REPLY_BYTES: usize = 4 * 1024 * 1024;

#[tauri::command]
pub async fn filmcraft_request(
    token: String,
    method: String,
    params: Value,
) -> Result<Value, String> {
    request_at(PORT, token, method, params).await
}

async fn request_at(
    port: u16,
    token: String,
    method: String,
    params: Value,
) -> Result<Value, String> {
    if token.len() != 64 || !token.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("Enter the 64-character FilmCraft control token.".into());
    }
    if method != "engine.execute"
        || !matches!(
            params.get("command").and_then(Value::as_str),
            Some(
                "sequence.inspect"
                    | "project.inspect"
                    | "file.exportMedia"
                    | "captions.import"
                    | "playhead.set"
                    | "jobs.list"
                    | "jobs.cancel"
            )
        )
    {
        return Err("Unsupported FilmCraft request.".into());
    }
    let request = json!({"id": 1, "token": token, "method": method, "params": params});
    let mut wire = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
    wire.push(b'\n');
    if wire.len() > MAX_REPLY_BYTES {
        return Err("FilmCraft request is too large.".into());
    }

    let stream = timeout(
        Duration::from_secs(3),
        TcpStream::connect(("127.0.0.1", port)),
    )
    .await
    .map_err(|_| "FilmCraft did not respond on port 9876.".to_string())?
    .map_err(|e| format!("Cannot connect to FilmCraft on port 9876: {e}"))?;
    let (reader, mut writer) = stream.into_split();
    timeout(Duration::from_secs(5), writer.write_all(&wire))
        .await
        .map_err(|_| "Timed out sending the request to FilmCraft.".to_string())?
        .map_err(|e| e.to_string())?;

    let mut reader = BufReader::new(reader).take((MAX_REPLY_BYTES + 1) as u64);
    let mut line = Vec::new();
    let received = timeout(Duration::from_secs(65), reader.read_until(b'\n', &mut line))
        .await
        .map_err(|_| "FilmCraft did not finish the request in time.".to_string())?
        .map_err(|e| e.to_string())?;
    if received == 0 || received > MAX_REPLY_BYTES {
        return Err("FilmCraft returned an empty or oversized reply.".into());
    }
    let reply: Value =
        serde_json::from_slice(&line).map_err(|e| format!("Invalid FilmCraft reply: {e}"))?;
    if reply.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(reply
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("FilmCraft rejected the request.")
            .to_string());
    }
    Ok(reply.get("result").cloned().unwrap_or(Value::Null))
}

#[cfg(test)]
mod tests {
    use super::request_at;
    use serde_json::{Value, json};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn authenticated_json_line_round_trip() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let token = "a".repeat(64);
        let expected_token = token.clone();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (reader, mut writer) = stream.into_split();
            let mut line = String::new();
            BufReader::new(reader).read_line(&mut line).await.unwrap();
            let request: Value = serde_json::from_str(&line).unwrap();
            assert_eq!(request["token"], expected_token);
            assert_eq!(request["method"], "engine.execute");
            assert_eq!(request["params"]["command"], "sequence.inspect");
            writer
                .write_all(b"{\"id\":1,\"ok\":true,\"result\":{\"id\":7}}\n")
                .await
                .unwrap();
        });
        let result = request_at(
            port,
            token,
            "engine.execute".into(),
            json!({"command": "sequence.inspect", "params": {}}),
        )
        .await
        .unwrap();
        assert_eq!(result["id"], 7);
        server.await.unwrap();
    }
}
