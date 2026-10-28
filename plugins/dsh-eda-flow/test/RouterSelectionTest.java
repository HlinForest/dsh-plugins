public class RouterSelectionTest {
  static void expect(boolean value,String message){if(!value)throw new AssertionError(message);}
  public static void main(String[] args){
    expect(DshRouter.better(new double[]{0,0,600,80},new double[]{0,1,100,5}),"complete board must beat shorter incomplete route");
    expect(!DshRouter.better(new double[]{0,1,100,5},new double[]{0,0,600,80}),"do not trade connectivity for length");
    expect(!DshRouter.better(new double[]{1,0,80,2},new double[]{0,2,200,8}),"clearance violations are not accepted");
    expect(DshRouter.better(new double[]{0,1,800,90},new double[]{0,2,100,3}),"fewer opens dominate route cost");
    expect(DshRouter.better(new double[]{0,0,390,40},new double[]{0,0,400,40}),"optimize length among complete legal candidates");
    expect(!DshRouter.better(new double[]{0,0,390,40},new double[]{0,0,390,40}),"stable ties avoid needless copies");
    System.out.println("6 route-selection assertions passed");
  }
}
