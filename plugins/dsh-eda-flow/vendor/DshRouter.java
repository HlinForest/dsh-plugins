import java.lang.reflect.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
// Use the bundled Freerouting API without the CLI resetting DSN routing constraints.
public class DshRouter {
  static Class<?> cls(String s)throws Exception{return Class.forName("app.freerouting."+s);}
  static Object get(Object o,String f)throws Exception{return o.getClass().getField(f).get(o);}
  static void set(Object o,String f,Object v)throws Exception{o.getClass().getField(f).set(o,v);}
  static Object call(Object o,String name,Object...args)throws Exception{
    for(Method m:o.getClass().getMethods())if(m.getName().equals(name)&&m.getParameterCount()==args.length){
      try{return m.invoke(o,args);}catch(IllegalArgumentException e){continue;}
    }throw new NoSuchMethodException(name);
  }
  public static void main(String[] args)throws Exception{
    Object global=cls("settings.GlobalSettings").getConstructor().newInstance();
    cls("Freerouting").getField("globalSettings").set(null,global);
    Object job=cls("core.RoutingJob").getConstructor().newInstance();
    call(job,"setInput",args[0]);
    Object manager=cls("interactive.HeadlessBoardManager").getConstructor(Locale.class,job.getClass()).newInstance(Locale.ENGLISH,job);
    Object ids=cls("board.ItemIdentificationNumberGenerator").getConstructor().newInstance();
    try(InputStream in=Files.newInputStream(Path.of(args[0]))){System.out.println("DSN read: "+call(manager,"loadFromSpecctraDsn",in,null,ids));}
    Object board=call(manager,"get_routing_board");if(board==null)throw new IllegalStateException("DSN did not create a board");
    set(job,"board",board);
    Object settings=get(call(manager,"get_settings"),"autoroute_settings");
    set(settings,"maxPasses",Integer.parseInt(args[2]));call(settings,"set_stop_pass_no",Integer.parseInt(args[2]));set(settings,"jobTimeoutString","00:03:00");set(settings,"maxThreads",1);
    set(job,"routerSettings",settings);
    System.out.println("Routing layers="+Arrays.toString((boolean[])get(settings,"isLayerActive"))+" vias="+get(settings,"vias_allowed"));
    Object thread=cls("management.RoutingJobSchedulerActionThread").getConstructor(job.getClass()).newInstance(job);
    set(job,"thread",thread);
    Class<?> states=cls("core.RoutingJobState");set(job,"state",states.getField("RUNNING").get(null));
    java.util.concurrent.atomic.AtomicReference<Throwable> failure=new java.util.concurrent.atomic.AtomicReference<>();
    ((Thread)thread).setUncaughtExceptionHandler((t,e)->failure.set(e));
    ((Thread)thread).start();((Thread)thread).join(220000);
    if(((Thread)thread).isAlive())throw new IllegalStateException("Router timed out");
    if(failure.get()!=null)throw new RuntimeException("Routing engine failed",failure.get());
    call(manager,"replaceRoutingBoard",get(job,"board"));
    try(OutputStream out=Files.newOutputStream(Path.of(args[1]))){if(!Boolean.TRUE.equals(call(manager,"saveAsSpecctraSessionSes",out,Path.of(args[0]).getFileName().toString())))throw new IOException("SES export failed");}
    System.out.println("Routing state="+get(job,"state"));System.exit(0);
  }
}
