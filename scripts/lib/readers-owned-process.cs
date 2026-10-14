using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Windows-only supervisor. The child cannot execute until assigned to a job
// without breakaway permission. No process enumeration or foreign PID killing.
public static class ReadersOwnedProcess {
 public sealed class Result {
  public bool Started, Assigned, EmptyVerified, TimedOut, DescendantsStopped;
  public uint ExitCode = 1;
  public string Failure = "";
 }
 [StructLayout(LayoutKind.Sequential)] struct Security { public int Size; public IntPtr Descriptor; public int Inherit; }
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
  public int Size; public string Reserved, Desktop, Title;
  public uint X,Y,XSize,YSize,XChars,YChars,Fill,Flags;
  public ushort Show,ReservedSize; public IntPtr ReservedBytes,Input,Output,Error;
 }
 [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process,Thread; public uint Pid,Tid; }
 [StructLayout(LayoutKind.Sequential)] struct BasicLimit {
  public long ProcessTime,JobTime; public uint Flags; public UIntPtr Min,Max;
  public uint ActiveLimit; public UIntPtr Affinity; public uint Priority,Scheduling;
 }
 [StructLayout(LayoutKind.Sequential)] struct Io { public ulong A,B,C,D,E,F; }
 [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit {
  public BasicLimit Basic; public Io Io; public UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob;
 }
 [StructLayout(LayoutKind.Sequential)] struct Accounting {
  public long User,Kernel,PeriodUser,PeriodKernel;
  public uint Faults,Total,Active,Terminated;
 }
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref ExtendedLimit info,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,out Accounting info,uint length,IntPtr returned);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint millis);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateFile(string path,uint access,uint share,ref Security security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr environment,string directory,ref Startup startup,out ProcessInfo info);
 static bool Valid(IntPtr h) { return h!=IntPtr.Zero && h!=new IntPtr(-1); }
 static uint Active(IntPtr job) {
  Accounting info;
  if(!QueryInformationJobObject(job,1,out info,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero)) throw new Exception("JOB_QUERY_FAILED");
  return info.Active;
 }
 static bool Empty(IntPtr job,int milliseconds) {
  if(milliseconds<=0) return Active(job)==0;
  var clock=Stopwatch.StartNew();
  do { if(Active(job)==0) return true; Thread.Sleep(25); } while(clock.ElapsedMilliseconds<milliseconds);
  return Active(job)==0;
 }
 // Windows command line quoting, including trailing backslashes and quotes.
 static string Quote(string value) {
  var b=new StringBuilder("\""); int slashes=0;
  foreach(char c in value) {
   if(c=='\\') { slashes++; continue; }
   if(c=='\"') { b.Append('\\',slashes*2+1); b.Append(c); }
   else { b.Append('\\',slashes); b.Append(c); }
   slashes=0;
  }
  b.Append('\\',slashes*2); b.Append('"'); return b.ToString();
 }
 public static Result Run(string executable,string[] arguments,string directory,string log,int deadlineMs,int cleanupMs) {
  if(deadlineMs<100 || deadlineMs>35*60*1000 || cleanupMs<100 || cleanupMs>10000) throw new Exception("PROCESS_BOUNDS");
  var result=new Result(); IntPtr job=IntPtr.Zero,output=IntPtr.Zero,input=IntPtr.Zero;
  ProcessInfo process=new ProcessInfo(); Stopwatch cleanupClock=null;
  try {
   job=CreateJobObject(IntPtr.Zero,null); if(!Valid(job)) throw new Exception("JOB_CREATE_FAILED");
   var limits=new ExtendedLimit(); limits.Basic.Flags=0x2000; // KILL_ON_JOB_CLOSE; no breakaway.
   if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimit)))) throw new Exception("JOB_LIMIT_FAILED");
   var security=new Security{Size=Marshal.SizeOf(typeof(Security)),Inherit=1};
   output=CreateFile(log,0x40000000,1,ref security,1,0x80,IntPtr.Zero); // CREATE_NEW, read sharing only.
   if(!Valid(output)) throw new Exception("PRIVATE_LOG_CREATE_FAILED");
   input=CreateFile("NUL",0x80000000,3,ref security,3,0,IntPtr.Zero);
   if(!Valid(input)) throw new Exception("PROCESS_STDIN_FAILED");
   var startup=new Startup{Size=Marshal.SizeOf(typeof(Startup)),Flags=0x100,Input=input,Output=output,Error=output};
   var command=new StringBuilder(Quote(executable)); foreach(string arg in arguments) command.Append(" ").Append(Quote(arg));
   if(!CreateProcess(executable,command,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,directory,ref startup,out process)) throw new Exception("PROCESS_CREATE_FAILED");
   result.Started=true;
   if(!AssignProcessToJobObject(job,process.Process)) throw new Exception("JOB_ASSIGN_FAILED");
   result.Assigned=true;
   if(ResumeThread(process.Thread)==0xffffffff) throw new Exception("PROCESS_RESUME_FAILED");
   var clock=Stopwatch.StartNew();
   while(true) {
    uint waited=WaitForSingleObject(process.Process,100);
    if(waited==0) break;
    if(waited!=258) throw new Exception("PROCESS_WAIT_FAILED");
    if(clock.ElapsedMilliseconds>=deadlineMs) { result.TimedOut=true; result.Failure="PROCESS_DEADLINE"; break; }
   }
   if(!result.TimedOut && !GetExitCodeProcess(process.Process,out result.ExitCode)) throw new Exception("PROCESS_EXIT_FAILED");
   // Process signaling may precede the job's accounting notification. Allow a
   // short drain within (not in addition to) the cleanup budget.
   cleanupClock=Stopwatch.StartNew();
   bool drained=!result.TimedOut && Empty(job,Math.Min(500,cleanupMs));
   if(!drained && Active(job)!=0) {
    result.DescendantsStopped=!result.TimedOut;
    if(!TerminateJobObject(job,1)) throw new Exception("JOB_TERMINATE_FAILED");
    if(result.DescendantsStopped) result.Failure="DESCENDANTS_AFTER_PARENT_EXIT";
   }
   result.EmptyVerified=Empty(job,Math.Max(0,cleanupMs-(int)cleanupClock.ElapsedMilliseconds));
   if(!result.EmptyVerified) result.Failure="OWNED_TREE_CLEANUP_UNVERIFIED";
  } catch(Exception error) {
   // Only fixed internal enums can leave this boundary; never Win32 messages.
   string code=error.Message;
   result.Failure=(code=="JOB_CREATE_FAILED" || code=="JOB_LIMIT_FAILED" || code=="PRIVATE_LOG_CREATE_FAILED" || code=="PROCESS_STDIN_FAILED" || code=="PROCESS_CREATE_FAILED" || code=="JOB_ASSIGN_FAILED" || code=="PROCESS_RESUME_FAILED" || code=="PROCESS_EXIT_FAILED" || code=="PROCESS_WAIT_FAILED" || code=="JOB_QUERY_FAILED" || code=="JOB_TERMINATE_FAILED") ? code : "OWNED_PROCESS_FAILED";
   if(!result.Started) result.EmptyVerified=true;
   else try {
    if(cleanupClock==null) cleanupClock=Stopwatch.StartNew();
    if(result.Assigned) { TerminateJobObject(job,1); result.EmptyVerified=Empty(job,Math.Max(0,cleanupMs-(int)cleanupClock.ElapsedMilliseconds)); }
    else { TerminateProcess(process.Process,1); result.EmptyVerified=WaitForSingleObject(process.Process,(uint)Math.Max(0,cleanupMs-(int)cleanupClock.ElapsedMilliseconds))==0; }
   } catch { result.EmptyVerified=false; }
   if(!result.EmptyVerified) result.Failure="OWNED_TREE_CLEANUP_UNVERIFIED";
  } finally {
   if(Valid(process.Thread)) CloseHandle(process.Thread);
   if(Valid(process.Process)) CloseHandle(process.Process);
   if(Valid(job)) CloseHandle(job);
   if(Valid(input)) CloseHandle(input);
   if(Valid(output)) CloseHandle(output);
  }
  return result;
 }
}
