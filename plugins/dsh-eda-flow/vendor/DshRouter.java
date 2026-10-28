import java.lang.reflect.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
// Use the bundled Freerouting API without the CLI resetting DSN routing constraints.
public class DshRouter {
  // Freerouting's score blends completion and route cost. Retain the best
  // actual event board lexicographically, including transient complete routes
  // that a later rip-up pass or weighted-score restore can otherwise discard.
  static double[] rank(Object board)throws Exception{
    Object stats=call(board,"get_statistics");Object bends=get(stats,"bends");
    return new double[]{((Number)get(get(stats,"clearanceViolations"),"totalCount")).doubleValue(),
      ((Number)get(get(stats,"connections"),"incompleteCount")).doubleValue(),
      ((Number)get(get(stats,"traces"),"totalLength")).doubleValue(),
      ((Number)get(bends,"ninetyDegreeCount")).doubleValue()+((Number)get(bends,"fortyFiveDegreeCount")).doubleValue()+((Number)get(bends,"otherAngleCount")).doubleValue()};
  }
  static boolean better(double[] a,double[] b){
    if(b==null)return true;
    for(int i=0;i<a.length;i++){int c=Double.compare(a[i],b[i]);if(c!=0)return c<0;}
    return false;
  }
  static final class Incumbent {
    Object board;double[] rank;int snapshots,events;
    void consider(Object candidate)throws Exception{
      events++;double[] value=DshRouter.rank(candidate);
      if(better(value,rank)){board=call(candidate,"deepCopy");rank=value;snapshots++;}
    }
  }
  static void algorithm(String name,Object job,Incumbent best,long deadline)throws Exception{
    Object algorithm=cls("autoroute."+name).getConstructor(job.getClass()).newInstance(job);
    Class<?> listenerType=cls("autoroute.events.BoardUpdatedEventListener");
    Object listener=Proxy.newProxyInstance(listenerType.getClassLoader(),new Class<?>[]{listenerType},(proxy,method,args)->{
      if(method.getName().equals("onBoardUpdatedEvent")){best.consider(call(args[0],"getBoard"));return null;}
      if(method.getName().equals("hashCode"))return System.identityHashCode(proxy);
      if(method.getName().equals("equals"))return proxy==args[0];
      return "DSH native board observer";
    });
    call(algorithm,"addBoardUpdatedEventListener",listener);
    java.util.concurrent.atomic.AtomicReference<Throwable> failure=new java.util.concurrent.atomic.AtomicReference<>();
    Thread runner=new Thread(()->{try{call(algorithm,"runBatchLoop");}catch(Throwable e){failure.set(e);}},"dsh-"+name);
    runner.setDaemon(true);runner.start();runner.join(Math.max(1,deadline-System.currentTimeMillis()));
    if(runner.isAlive()){call(get(job,"thread"),"requestStop");runner.join(10000);}
    if(runner.isAlive())throw new IllegalStateException("Router did not stop within its deadline");
    if(failure.get()!=null)throw new RuntimeException("Routing engine failed",failure.get());
    best.consider(get(job,"board"));set(job,"board",call(best.board,"deepCopy"));
  }
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
    if(args.length<4){
      // Preserve the released integration unless a candidate explicitly opts in.
      java.util.concurrent.atomic.AtomicReference<Throwable> failure=new java.util.concurrent.atomic.AtomicReference<>();
      ((Thread)thread).setUncaughtExceptionHandler((t,e)->failure.set(e));
      ((Thread)thread).start();((Thread)thread).join(220000);
      if(((Thread)thread).isAlive())throw new IllegalStateException("Router timed out");
      if(failure.get()!=null)throw new RuntimeException("Routing engine failed",failure.get());
    }else{
      if(!args[3].equals("connectivity-first"))throw new IllegalArgumentException("Unknown routing search mode");
      Incumbent best=new Incumbent();best.consider(board);Object initial=call(board,"deepCopy");
      long deadline=System.currentTimeMillis()+200000;int passes=Integer.parseInt(args[2]),used=0,restarts=0;
      if(Boolean.TRUE.equals(call(settings,"getRunFanout")))algorithm("BatchFanout",job,best,deadline);
      // Bound each exploration, even if an upstream loop has fewer than its
      // minimum number of distinct historical boards and never restores one.
      // Alternate the generated incumbent and fresh DSN starts; no part poses
      // or nets are changed, and the best native event board is never lost.
      while(used<passes&&System.currentTimeMillis()<deadline-1000&&best.rank[1]>0){
        int batch=Math.min(20,passes-used);call(settings,"set_start_pass_no",1);call(settings,"set_stop_pass_no",batch);
        set(job,"thread",cls("management.RoutingJobSchedulerActionThread").getConstructor(job.getClass()).newInstance(job));
        set(job,"board",call(restarts%3==2?initial:best.board,"deepCopy"));
        algorithm("BatchAutorouter",job,best,deadline);used+=batch;restarts++;
        System.out.println("DSH search batch="+restarts+" retained="+Arrays.toString(best.rank));
      }
      if(best.rank[0]==0&&best.rank[1]==0&&System.currentTimeMillis()<deadline-1000&&Boolean.TRUE.equals(call(settings,"getRunOptimizer"))){
        set(job,"thread",cls("management.RoutingJobSchedulerActionThread").getConstructor(job.getClass()).newInstance(job));
        algorithm("BatchOptimizer",job,best,deadline);
      }
      set(job,"state",states.getField("COMPLETED").get(null));
      Path evidence=Path.of(args[1]+".selection.json");
      Files.writeString(evidence,"{\"policy\":\"clearance violations, incomplete connections, router length, bends\",\"rank\":"+Arrays.toString(best.rank)+",\"events\":"+best.events+",\"snapshots\":"+best.snapshots+",\"searchBatches\":"+restarts+",\"nativeAcceptanceRequired\":true}");
    }
    call(manager,"replaceRoutingBoard",get(job,"board"));
    try(OutputStream out=Files.newOutputStream(Path.of(args[1]))){if(!Boolean.TRUE.equals(call(manager,"saveAsSpecctraSessionSes",out,Path.of(args[0]).getFileName().toString())))throw new IOException("SES export failed");}
    System.out.println("Routing state="+get(job,"state"));System.exit(0);
  }
}
