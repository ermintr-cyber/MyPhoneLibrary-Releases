import tempfile,unittest
from server import Store
class DonorTests(unittest.TestCase):
 def test_donor_flag_survives_save_and_can_be_cleared(self):
  with tempfile.TemporaryDirectory() as tmp:
   s=Store(tmp)
   r=s.save_record({'kind':'phone','brand':'Nokia','model':'N73','instances':[{'for_parts':True,'inv':'1'}]})
   self.assertTrue(r['instances'][0]['for_parts']);self.assertEqual(r['instances'][0]['purpose'],'Donor')
   r['instances'][0]['for_parts']=False;r['instances'][0]['purpose']='Kolekcija'
   r=s.save_record(r,r['rev']);self.assertFalse(r['instances'][0]['for_parts'])
