import {Site_Manager_KPI} from '../../models/rms/Site_manager_KPI.js' 

const update_Site_Manager_Over_All_KPI = async (KPI_installments, siteManagerID) =>{
    try{
        var total_over_all_target_amount = 0
        var total_over_all_achieved_amount = 0
        var total_over_all_KPI_percentage = 0

        
        KPI_installments.forEach(KPI_installment =>{
            total_over_all_target_amount += KPI_installment.target_amount? KPI_installment.target_amount : 0 ;
            total_over_all_achieved_amount += KPI_installment.achieved_amount ? KPI_installment.achieved_amount: 0;
            total_over_all_KPI_percentage += KPI_installment.KPI_percentage ? KPI_installment.KPI_percentage: 0 ;
          });
        
        
          await Site_Manager_KPI.updateOne(
            {_id:siteManagerID},
            {
              $set: {
                "over_all_target_amount": total_over_all_target_amount,
                "over_all_achieved_amount":total_over_all_achieved_amount,
                "over_all_KPI_percentage": ((total_over_all_achieved_amount /total_over_all_target_amount) * 100).toFixed(2),
              }
            }
          )

          return true
    }
    catch (e){
        console.log(e)
        return false
    }
    
}

export default update_Site_Manager_Over_All_KPI


