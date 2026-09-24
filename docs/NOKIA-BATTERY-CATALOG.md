# Nokia battery catalog — 24 September 2026

Source: https://lpcwiki.miraheze.org/wiki/Category:Nokia_batteries

All 49 category entries were read. The imported catalog has 53 entries: 52 batteries/variants and the LRW-1 Bluetooth battery holder. Four separately described variants were added: BV-4D, BL-4WL, Microsoft BL-L4A and Microsoft BL-T5A. There are 526 model associations, including qualified alternatives and unresolved source claims; this is not a count of distinct phones or independently verified compatibility claims.

## Import behavior

On the next Windows server startup with this change, create a verified backup, update matching battery codes (including Nokia/Microsoft/BYD-prefixed names) without replacing their IDs, and add missing entries. Source specifications and notes overwrite existing corresponding values. Custom specification keys and phone references remain. Previous catalog metadata is retained in the database as well as the collection backup. The import runs once per source revision; later user edits are not overwritten on restart.

Only explicitly full compatibility becomes a symmetric catalog link: BL-4D ↔ BV-4D, BL-4J ↔ BL-5J, BL-4UL ↔ BL-4WL. Similar dimensions alone are insufficient. Existing compatibility links involving imported batteries are replaced with these source-supported links.

Phone suggestions match brand and complete model, ignoring case, spacing and punctuation but preserving variant words and `+`. No battery is automatically selected. Qualified or conflicting entries carry a warning. The source phone list, notes, additional specifications and source URL appear in the battery editor. Existing collection phone records are not created or overwritten by these reference lists.

## Source issues and limitations

- Asha 500 appears on both BL-4U and BL-4UL lists despite incompatible pinouts. Both suggestions require verification.
- Nokia 225 appears on both BL-5C and BL-4UL lists. Exact year/variant and original battery need verification.
- BL-5CB versus BL-5C: different BSI resistance may prevent charging. They are not unconditional alternatives.
- BL-4C/BL-5C/BL-6C: thickness and rear-cover fit matter. BL-5C and BL-6C are both listed as 53 × 34 × 6 mm despite the text calling BL-6C thicker.
- BLB-2 versus BLD-3: the thicker BLB-2 can prevent the cover closing.
- BMC-3 list explicitly includes possible BLC-1/BLC-2 phones. BLC-2 says newer phones such as 3510 do not support BMC-3. All BMC-3 associations are qualified.
- BP-3L cannot charge in a BP-4L phone. BP-6M is not compatible with BP-6MT/BP-5M contacts. BL-4CT/BL-4C and BL-5CT/BL-5C also have different pinouts.
- BP-5M/BP-6MT are described as mostly interchangeable. No unconditional compatibility link is generated.
- BL-6Q as an alternative for N82/E51 is explicitly reported on the BP-6MT page; reverse substitution is not established.
- BP-6X category link is a double redirect through BP-5X to BL-5X. Its 700 mAh Li-Po variant specifications come from BL-5X; verify the physical label.
- BV-L4A and BV-T5A redirect to Microsoft pages containing separate BL and BV specifications but shared phone lists. Assignment to each variant remains qualified.
- LRW-1 is a Bluetooth holder for BLB-3 and requires Nokia 6210 firmware 5.02+. It is not suggested as a standalone battery.
- BP-5H is a prototype battery; the source rejects retail 701/Lumia 620/630 claims.
- BL-5C recall history and BML-3 recelling notes are retained as source information, not instructions or proof a particular physical battery is safe.
- Unknown specifications (`?`) remain unknown. Dimensions stay in the source's order rather than guessing length/width/thickness.

Dataset attribution and CC BY-SA 4.0 license are in THIRD-PARTY.md and every battery's notes. This change is prepared for a future release; existing Android APKs retain their packaged interface and need a separate Android update to display the new suggestion UI.
