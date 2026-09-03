using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("Start MYP")]
[assembly: AssemblyProduct("Mind Your Prompt")]
[assembly: AssemblyDescription("Local launcher for Mind Your Prompt")]
[assembly: AssemblyCompany("")]
[assembly: AssemblyVersion("1.5.0.0")]
[assembly: AssemblyFileVersion("1.5.0.0")]

internal static class StartMyp
{
    [STAThread]
    private static void Main()
    {
        string rootDirectory = AppDomain.CurrentDomain.BaseDirectory;
        string scriptPath = Path.Combine(rootDirectory, "MYP.ps1");

        if (!File.Exists(scriptPath))
        {
            MessageBox.Show(
                "MYP.ps1 was not found next to Start MYP.exe.",
                "Start MYP",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        string powershellPath = Environment.ExpandEnvironmentVariables(
            @"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe");

        try
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = powershellPath,
                Arguments = "-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File \"" + scriptPath + "\"",
                WorkingDirectory = rootDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };

            Process.Start(startInfo);
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "Unable to start Mind Your Prompt.\n\n" + error.Message,
                "Start MYP",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }
}
