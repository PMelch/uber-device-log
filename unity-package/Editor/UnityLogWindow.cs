using UnityEditor;
using UnityEngine;

namespace UberDeviceLog
{
    internal sealed class UnityLogWindow : EditorWindow
    {
        string url, project, code = "", senderName;
        [MenuItem("Tools/Über Device Log")]
        static void Open() { GetWindow<UnityLogWindow>("Über Device Log"); }
        void OnEnable()
        {
            url = UnityLogTransport.Url;
            project = UnityLogTransport.ProjectId;
            senderName = UnityLogTransport.Name;
        }
        void OnInspectorUpdate() { Repaint(); }
        void OnGUI()
        {
            EditorGUILayout.LabelField("Unity Editor logs · Local only", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox("Request a pairing code in the local viewer. Copy its separate project ID here. Codes expire after 120 seconds. Pairing does not start capture.", MessageType.Info);
            bool locked = UnityLogTransport.Connected || UnityLogTransport.Busy;
            using (new EditorGUI.DisabledScope(locked))
            {
                url = EditorGUILayout.TextField("Viewer URL", url);
                project = EditorGUILayout.TextField("Project ID", project);
                senderName = EditorGUILayout.TextField("Editor name", senderName);
                code = EditorGUILayout.PasswordField("Pairing code", code);
                if (GUILayout.Button("Pair"))
                {
                    UnityLogTransport.Pair(url, project, code, senderName);
                    code = "";
                }
            }
            using (new EditorGUI.DisabledScope(locked || !UnityLogTransport.Paired))
            {
                if (GUILayout.Button("Connect")) UnityLogTransport.Connect();
            }
            using (new EditorGUI.DisabledScope(!locked))
            {
                if (GUILayout.Button("Disconnect")) UnityLogTransport.Disconnect();
            }
            if (GUILayout.Button("Forget pairing")) { UnityLogTransport.Forget(); code = ""; }
            EditorGUILayout.LabelField("Status", UnityLogTransport.Status, EditorStyles.wordWrappedLabel);
            EditorGUILayout.LabelField("Unreported dropped logs", UnityLogTransport.Dropped.ToString());
            EditorGUILayout.HelpBox("Connect uses the last successfully paired settings. To change settings, disconnect and pair again. Disconnect stops capture and discards queued logs; it retains pairing across restarts. Forget removes the local token, not the server authorization. The viewer marks a silent Editor offline after 15 seconds. Closing this window does not disconnect.", MessageType.None);
        }
    }
}
