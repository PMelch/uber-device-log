using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;
using UnityEngine.Networking;

namespace UberDeviceLog
{
    // All networking and Unity APIs run on EditorApplication.update, never the log callback.
    [InitializeOnLoad]
    internal static class UnityLogTransport
    {
        const string Key = "UberDeviceLog.Editor.";
        const int QueueLimit = 1000;
        const int BatchLimit = 50;
        const int MaxPayloadBytes = 255 * 1024;
        const double HeartbeatSeconds = 2;
        static readonly object Gate = new object();
        static readonly Queue<LogEntry> Queue = new Queue<LogEntry>();
        static string token, instanceId;
        static string credentialPath;
        [Serializable] sealed class Credentials { public string url, project, name, token, instance; public bool connected; }
        [DllImport("libc", SetLastError = true)] static extern int chmod(string path, uint mode);
        static void PrivatePath(string path, uint mode)
        {
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new IOException("Linked credential path");
            if (Application.platform != RuntimePlatform.WindowsEditor && chmod(path, mode) != 0) throw new IOException("Cannot secure credential path");
        }
        static void LoadCredentials()
        {
            try
            {
                string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "UberDeviceLog");
                Directory.CreateDirectory(root); PrivatePath(root, 448); // 0700
                using (var hash = SHA256.Create())
                    credentialPath = Path.Combine(root, BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(Application.dataPath)))).Replace("-", "") + ".json");
                if (!File.Exists(credentialPath)) return;
                PrivatePath(credentialPath, 384); // 0600
                if (new FileInfo(credentialPath).Length > 8192) throw new IOException("Invalid credentials");
                var saved = JsonUtility.FromJson<Credentials>(File.ReadAllText(credentialPath));
                if (saved == null || !ValidUrl(saved.url) || !Regex.IsMatch(saved.token ?? "", @"\A[a-f0-9]{64}\z") || !Regex.IsMatch(saved.instance ?? "", @"\A[a-f0-9]{32}\z") || !Regex.IsMatch(saved.project ?? "", @"\A[a-f0-9-]{36}\z") || string.IsNullOrEmpty(saved.name) || saved.name.Length > 128) return;
                Url = saved.url; ProjectId = saved.project; Name = saved.name; token = saved.token; instanceId = saved.instance;
                SessionState.SetBool(Key + "connected", saved.connected);
            }
            catch (Exception) { credentialPath = null; Status = "Private credential storage unavailable; pair for this session."; }
        }
        static void SaveCredentials(bool connected)
        {
            if (string.IsNullOrEmpty(credentialPath) || !Paired) return;
            string temporary = credentialPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                // Secure the empty file before any bearer material is written.
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    PrivatePath(temporary, 384);
                    byte[] bytes = Encoding.UTF8.GetBytes(JsonUtility.ToJson(new Credentials { url=Url, project=ProjectId, name=Name, token=token, instance=instanceId, connected=connected }));
                    stream.Write(bytes, 0, bytes.Length); stream.Flush();
                }
                if (File.Exists(credentialPath)) File.Replace(temporary, credentialPath, null);
                else File.Move(temporary, credentialPath);
            }
            catch (Exception) { Status = "Pairing works for this session; private storage failed."; }
            finally { try { if (File.Exists(temporary)) File.Delete(temporary); } catch (Exception) {} }
        }
        static bool capturing, pairing;
        static UnityWebRequest request;
        static int failedCount, failures;
        static long dropped, sentDropped;
        static double nextSend, started;
        public static string Status { get; private set; } = "Disconnected";
        public static string Url { get; private set; }
        public static string ProjectId { get; private set; }
        public static string Name { get; private set; }
        public static bool Connected { get { return capturing; } }
        public static bool Busy { get { return request != null; } }
        public static bool Paired { get { return !string.IsNullOrEmpty(token); } }
        public static long Dropped { get { lock (Gate) return dropped; } }
        [Serializable] sealed class LogEntry { public string timestamp, message, stackTrace, type; }
        [Serializable] sealed class PairBody { public string code, projectId, instanceId, name; }
        [Serializable] sealed class PairResult { public string token, projectId; }
        [Serializable] sealed class Batch { public int version = 1; public string projectId, instanceId, name; public long dropped; public List<LogEntry> logs; }

        static UnityLogTransport()
        {
            Url = SessionState.GetString(Key + "url", "http://127.0.0.1:3000");
            ProjectId = SessionState.GetString(Key + "project", "");
            Name = SessionState.GetString(Key + "name", "Unity Editor");
            token = SessionState.GetString(Key + "token", "");
            instanceId = SessionState.GetString(Key + "instance", "");
            LoadCredentials();
            if (instanceId.Length == 0) instanceId = Guid.NewGuid().ToString("N");
            SessionState.SetString(Key + "instance", instanceId);
            dropped = long.TryParse(SessionState.GetString(Key + "dropped", "0"), out var count) ? count : 0;
            EditorApplication.update += Update;
            AssemblyReloadEvents.beforeAssemblyReload += Cleanup;
            EditorApplication.quitting += Cleanup;
            if (SessionState.GetBool(Key + "connected", false) && Paired) Connect();
        }
        public static bool ValidUrl(string value)
        {
            // Exact numeric loopback only: no DNS, credentials, path, query or fragment.
            if (!Regex.IsMatch(value ?? "", @"\Ahttp://127\.0\.0\.1:[0-9]{1,5}\z")) return false;
            return int.TryParse(value.Substring("http://127.0.0.1:".Length), out var port) && port > 0 && port <= 65535;
        }
        public static void Pair(string url, string project, string code, string name)
        {
            if (Busy || Connected) return;
            if (!ValidUrl(url) || string.IsNullOrWhiteSpace(project) || project.Length > 128 || string.IsNullOrWhiteSpace(code) || code.Length > 128)
            { Status = "Enter a numeric loopback URL, project ID and current pairing code."; return; }
            Forget();
            Url = url; ProjectId = project; Name = string.IsNullOrWhiteSpace(name) ? "Unity Editor" : Clip(name, 128);
            SessionState.SetString(Key + "url", Url);
            SessionState.SetString(Key + "project", ProjectId);
            SessionState.SetString(Key + "name", Name);
            pairing = true;
            Status = "Pairing…";
            Send("/api/unity/pair", JsonUtility.ToJson(new PairBody { code = code, projectId = ProjectId, instanceId = instanceId, name = Name }));
        }
        public static void Connect()
        {
            if (!Paired || !ValidUrl(Url) || Busy || capturing) return;
            lock (Gate) capturing = true;
            Application.logMessageReceivedThreaded += Capture;
            SessionState.SetBool(Key + "connected", true);
            SaveCredentials(true);
            failures = 0; nextSend = 0; Status = "Connecting…";
        }
        public static void Disconnect()
        {
            StopCapture();
            CancelRequest();
            SessionState.SetBool(Key + "connected", false);
            SaveCredentials(false);
            Status = "Disconnected (pairing retained)";
        }
        public static void Forget()
        {
            Disconnect(); token = "";
            SessionState.EraseString(Key + "token");
            try { if (!string.IsNullOrEmpty(credentialPath)) File.Delete(credentialPath); } catch (Exception) { Status = "Cannot delete stored pairing; revoke in viewer."; return; }
            Status = "Pairing forgotten locally";
        }
        static void StopCapture()
        {
            Application.logMessageReceivedThreaded -= Capture;
            lock (Gate) { capturing = false; AddDropped(Queue.Count); Queue.Clear(); }
        }
        static void AddDropped(long count) { dropped = Math.Min(long.MaxValue - count, dropped) + count; }
        static string Clip(string value, int cap)
        {
            value = value ?? "";
            if (value.Length <= cap) return value;
            // Never split a surrogate pair at the truncation boundary.
            if (char.IsHighSurrogate(value[cap - 1])) cap--;
            return value.Substring(0, cap);
        }
        static void Capture(string message, string stackTrace, LogType type)
        {
            lock (Gate)
            {
                if (!capturing) return;
                if (Queue.Count >= QueueLimit) { AddDropped(1); return; }
                string severity;
                switch (type)
                {
                    case LogType.Warning: severity = "Warning"; break;
                    case LogType.Error: severity = "Error"; break;
                    case LogType.Assert: severity = "Assert"; break;
                    case LogType.Exception: severity = "Exception"; break;
                    default: severity = "Log"; break;
                }
                Queue.Enqueue(new LogEntry { timestamp = DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture), message = Clip(message, 8192), stackTrace = Clip(stackTrace, 16384), type = severity });
            }
        }
        static void Send(string path, string json)
        {
            try
            {
                request = new UnityWebRequest(Url + path, "POST");
                request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
                request.downloadHandler = new DownloadHandlerBuffer();
                request.SetRequestHeader("Content-Type", "application/json");
                if (!pairing) request.SetRequestHeader("Authorization", "Bearer " + token);
                request.redirectLimit = 0;
                request.timeout = 2;
                started = EditorApplication.timeSinceStartup;
                request.SendWebRequest();
            }
            catch (Exception) { Complete(false); }
        }
        static void Update()
        {
            if (request != null)
            {
                if (!request.isDone && EditorApplication.timeSinceStartup - started < 2.5) return;
                Complete(request.isDone && request.result == UnityWebRequest.Result.Success);
            }
            if (!capturing || request != null || EditorApplication.timeSinceStartup < nextSend) return;
            var batch = new Batch { projectId = ProjectId, instanceId = instanceId, name = Name, logs = new List<LogEntry>() };
            string json;
            lock (Gate)
            {
                batch.dropped = dropped;
                while (Queue.Count > 0 && batch.logs.Count < BatchLimit)
                {
                    batch.logs.Add(Queue.Peek());
                    if (Encoding.UTF8.GetByteCount(JsonUtility.ToJson(batch)) >= MaxPayloadBytes)
                    {
                        batch.logs.RemoveAt(batch.logs.Count - 1);
                        if (batch.logs.Count == 0) { Queue.Dequeue(); AddDropped(1); }
                        break;
                    }
                    Queue.Dequeue();
                }
                batch.dropped = dropped;
                sentDropped = dropped;
                json = JsonUtility.ToJson(batch);
            }
            failedCount = batch.logs.Count;
            pairing = false;
            Send("/api/unity/batch", json);
        }
        static void Complete(bool success)
        {
            bool wasPairing = pairing;
            long responseCode = request == null ? 0 : request.responseCode;
            if (wasPairing && success)
            {
                try
                {
                    var result = JsonUtility.FromJson<PairResult>(request.downloadHandler.text);
                    success = result != null && result.projectId == ProjectId && Regex.IsMatch(result.token ?? "", @"\A[a-f0-9]{64}\z");
                    if (success) { token = result.token; SessionState.SetString(Key + "token", token); SaveCredentials(false); }
                }
                catch (Exception) { success = false; }
            }
            if (request != null) { request.Abort(); request.Dispose(); request = null; }
            pairing = false;
            if (wasPairing) { Status = success ? "Paired. Select Connect to start forwarding." : "Pairing failed. Request a fresh code and check the project ID."; return; }
            lock (Gate)
            {
                if (success) dropped = Math.Max(0, dropped - sentDropped);
                else AddDropped(failedCount);
            }
            failedCount = 0; sentDropped = 0;
            if (!success && (responseCode == 401 || responseCode == 403))
            { Forget(); Status = "Authorization expired or revoked. Pair again."; return; }
            failures = success ? 0 : Math.Min(8, failures + 1);
            nextSend = success ? Math.Max(started + HeartbeatSeconds, EditorApplication.timeSinceStartup) : EditorApplication.timeSinceStartup + Math.Min(8, Math.Pow(2, failures - 1));
            Status = success ? "Connected" : "Connection failed; retrying with backoff.";
        }
        static void CancelRequest()
        {
            if (request != null) { request.Abort(); request.Dispose(); request = null; }
            lock (Gate) AddDropped(failedCount);
            failedCount = 0; sentDropped = 0; pairing = false;
        }
        static void Cleanup()
        {
            // Preserve opt-in across domain reload; the next domain creates one subscription.
            StopCapture(); CancelRequest();
            lock (Gate) SessionState.SetString(Key + "dropped", dropped.ToString(CultureInfo.InvariantCulture));
            EditorApplication.update -= Update;
            AssemblyReloadEvents.beforeAssemblyReload -= Cleanup;
            EditorApplication.quitting -= Cleanup;
        }
    }
}
