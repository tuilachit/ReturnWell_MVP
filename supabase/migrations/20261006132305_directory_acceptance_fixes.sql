-- Acceptance repairs are additive: prior deployed migrations stay immutable.
-- Unicode 17.0 L/M and N/Cc/Cf ranges generated from the pinned Node runtime.
-- Explicit ranges avoid locale-dependent POSIX alpha and preserve the exact
-- entered spelling (including combining sequences) in the consent snapshot.
create function private.patient_contact_trim(value text) returns text
language sql immutable security invoker set search_path='' as $$
  select btrim(value,U&'\0009\000A\000B\000C\000D \00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;
create function private.patient_initials_valid(value text) returns boolean
language sql immutable security invoker set search_path='' as $$
  select coalesce(value,'') collate "C" !~ U&'[\0001-\001F\0030-\0039\007F-\009F\00AD\00B2-\00B3\00B9\00BC-\00BE\0600-\0605\061C\0660-\0669\06DD\06F0-\06F9\070F\07C0-\07C9\0890-\0891\08E2\0966-\096F\09E6-\09EF\09F4-\09F9\0A66-\0A6F\0AE6-\0AEF\0B66-\0B6F\0B72-\0B77\0BE6-\0BF2\0C66-\0C6F\0C78-\0C7E\0CE6-\0CEF\0D58-\0D5E\0D66-\0D78\0DE6-\0DEF\0E50-\0E59\0ED0-\0ED9\0F20-\0F33\1040-\1049\1090-\1099\1369-\137C\16EE-\16F0\17E0-\17E9\17F0-\17F9\180E\1810-\1819\1946-\194F\19D0-\19DA\1A80-\1A89\1A90-\1A99\1B50-\1B59\1BB0-\1BB9\1C40-\1C49\1C50-\1C59\200B-\200F\202A-\202E\2060-\2064\2066-\2070\2074-\2079\2080-\2089\2150-\2182\2185-\2189\2460-\249B\24EA-\24FF\2776-\2793\2CFD\3007\3021-\3029\3038-\303A\3192-\3195\3220-\3229\3248-\324F\3251-\325F\3280-\3289\32B1-\32BF\A620-\A629\A6E6-\A6EF\A830-\A835\A8D0-\A8D9\A900-\A909\A9D0-\A9D9\A9F0-\A9F9\AA50-\AA59\ABF0-\ABF9\FEFF\FF10-\FF19\FFF9-\FFFB\+010107-\+010133\+010140-\+010178\+01018A-\+01018B\+0102E1-\+0102FB\+010320-\+010323\+010341\+01034A\+0103D1-\+0103D5\+0104A0-\+0104A9\+010858-\+01085F\+010879-\+01087F\+0108A7-\+0108AF\+0108FB-\+0108FF\+010916-\+01091B\+0109BC-\+0109BD\+0109C0-\+0109CF\+0109D2-\+0109FF\+010A40-\+010A48\+010A7D-\+010A7E\+010A9D-\+010A9F\+010AEB-\+010AEF\+010B58-\+010B5F\+010B78-\+010B7F\+010BA9-\+010BAF\+010CFA-\+010CFF\+010D30-\+010D39\+010D40-\+010D49\+010E60-\+010E7E\+010F1D-\+010F26\+010F51-\+010F54\+010FC5-\+010FCB\+011052-\+01106F\+0110BD\+0110CD\+0110F0-\+0110F9\+011136-\+01113F\+0111D0-\+0111D9\+0111E1-\+0111F4\+0112F0-\+0112F9\+011450-\+011459\+0114D0-\+0114D9\+011650-\+011659\+0116C0-\+0116C9\+0116D0-\+0116E3\+011730-\+01173B\+0118E0-\+0118F2\+011950-\+011959\+011BF0-\+011BF9\+011C50-\+011C6C\+011D50-\+011D59\+011DA0-\+011DA9\+011DE0-\+011DE9\+011F50-\+011F59\+011FC0-\+011FD4\+012400-\+01246E\+013430-\+01343F\+016130-\+016139\+016A60-\+016A69\+016AC0-\+016AC9\+016B50-\+016B59\+016B5B-\+016B61\+016D70-\+016D79\+016E80-\+016E96\+016FF4-\+016FF6\+01BCA0-\+01BCA3\+01CCF0-\+01CCF9\+01D173-\+01D17A\+01D2C0-\+01D2D3\+01D2E0-\+01D2F3\+01D360-\+01D378\+01D7CE-\+01D7FF\+01E140-\+01E149\+01E2F0-\+01E2F9\+01E4F0-\+01E4F9\+01E5F1-\+01E5FA\+01E8C7-\+01E8CF\+01E950-\+01E959\+01EC71-\+01ECAB\+01ECAD-\+01ECAF\+01ECB1-\+01ECB4\+01ED01-\+01ED2D\+01ED2F-\+01ED3D\+01F100-\+01F10C\+01FBF0-\+01FBF9\+0E0001\+0E0020-\+0E007F]'
    and (coalesce(private.patient_contact_trim(value),'')='' or
      private.patient_contact_trim(value) collate "C" ~ U&'^[\0041-\005A\0061-\007A\00AA\00B5\00BA\00C0-\00D6\00D8-\00F6\00F8-\02C1\02C6-\02D1\02E0-\02E4\02EC\02EE\0300-\0374\0376-\0377\037A-\037D\037F\0386\0388-\038A\038C\038E-\03A1\03A3-\03F5\03F7-\0481\0483-\052F\0531-\0556\0559\0560-\0588\0591-\05BD\05BF\05C1-\05C2\05C4-\05C5\05C7\05D0-\05EA\05EF-\05F2\0610-\061A\0620-\065F\066E-\06D3\06D5-\06DC\06DF-\06E8\06EA-\06EF\06FA-\06FC\06FF\0710-\074A\074D-\07B1\07CA-\07F5\07FA\07FD\0800-\082D\0840-\085B\0860-\086A\0870-\0887\0889-\088F\0897-\08E1\08E3-\0963\0971-\0983\0985-\098C\098F-\0990\0993-\09A8\09AA-\09B0\09B2\09B6-\09B9\09BC-\09C4\09C7-\09C8\09CB-\09CE\09D7\09DC-\09DD\09DF-\09E3\09F0-\09F1\09FC\09FE\0A01-\0A03\0A05-\0A0A\0A0F-\0A10\0A13-\0A28\0A2A-\0A30\0A32-\0A33\0A35-\0A36\0A38-\0A39\0A3C\0A3E-\0A42\0A47-\0A48\0A4B-\0A4D\0A51\0A59-\0A5C\0A5E\0A70-\0A75\0A81-\0A83\0A85-\0A8D\0A8F-\0A91\0A93-\0AA8\0AAA-\0AB0\0AB2-\0AB3\0AB5-\0AB9\0ABC-\0AC5\0AC7-\0AC9\0ACB-\0ACD\0AD0\0AE0-\0AE3\0AF9-\0AFF\0B01-\0B03\0B05-\0B0C\0B0F-\0B10\0B13-\0B28\0B2A-\0B30\0B32-\0B33\0B35-\0B39\0B3C-\0B44\0B47-\0B48\0B4B-\0B4D\0B55-\0B57\0B5C-\0B5D\0B5F-\0B63\0B71\0B82-\0B83\0B85-\0B8A\0B8E-\0B90\0B92-\0B95\0B99-\0B9A\0B9C\0B9E-\0B9F\0BA3-\0BA4\0BA8-\0BAA\0BAE-\0BB9\0BBE-\0BC2\0BC6-\0BC8\0BCA-\0BCD\0BD0\0BD7\0C00-\0C0C\0C0E-\0C10\0C12-\0C28\0C2A-\0C39\0C3C-\0C44\0C46-\0C48\0C4A-\0C4D\0C55-\0C56\0C58-\0C5A\0C5C-\0C5D\0C60-\0C63\0C80-\0C83\0C85-\0C8C\0C8E-\0C90\0C92-\0CA8\0CAA-\0CB3\0CB5-\0CB9\0CBC-\0CC4\0CC6-\0CC8\0CCA-\0CCD\0CD5-\0CD6\0CDC-\0CDE\0CE0-\0CE3\0CF1-\0CF3\0D00-\0D0C\0D0E-\0D10\0D12-\0D44\0D46-\0D48\0D4A-\0D4E\0D54-\0D57\0D5F-\0D63\0D7A-\0D7F\0D81-\0D83\0D85-\0D96\0D9A-\0DB1\0DB3-\0DBB\0DBD\0DC0-\0DC6\0DCA\0DCF-\0DD4\0DD6\0DD8-\0DDF\0DF2-\0DF3\0E01-\0E3A\0E40-\0E4E\0E81-\0E82\0E84\0E86-\0E8A\0E8C-\0EA3\0EA5\0EA7-\0EBD\0EC0-\0EC4\0EC6\0EC8-\0ECE\0EDC-\0EDF\0F00\0F18-\0F19\0F35\0F37\0F39\0F3E-\0F47\0F49-\0F6C\0F71-\0F84\0F86-\0F97\0F99-\0FBC\0FC6\1000-\103F\1050-\108F\109A-\109D\10A0-\10C5\10C7\10CD\10D0-\10FA\10FC-\1248\124A-\124D\1250-\1256\1258\125A-\125D\1260-\1288\128A-\128D\1290-\12B0\12B2-\12B5\12B8-\12BE\12C0\12C2-\12C5\12C8-\12D6\12D8-\1310\1312-\1315\1318-\135A\135D-\135F\1380-\138F\13A0-\13F5\13F8-\13FD\1401-\166C\166F-\167F\1681-\169A\16A0-\16EA\16F1-\16F8\1700-\1715\171F-\1734\1740-\1753\1760-\176C\176E-\1770\1772-\1773\1780-\17D3\17D7\17DC-\17DD\180B-\180D\180F\1820-\1878\1880-\18AA\18B0-\18F5\1900-\191E\1920-\192B\1930-\193B\1950-\196D\1970-\1974\1980-\19AB\19B0-\19C9\1A00-\1A1B\1A20-\1A5E\1A60-\1A7C\1A7F\1AA7\1AB0-\1ADD\1AE0-\1AEB\1B00-\1B4C\1B6B-\1B73\1B80-\1BAF\1BBA-\1BF3\1C00-\1C37\1C4D-\1C4F\1C5A-\1C7D\1C80-\1C8A\1C90-\1CBA\1CBD-\1CBF\1CD0-\1CD2\1CD4-\1CFA\1D00-\1F15\1F18-\1F1D\1F20-\1F45\1F48-\1F4D\1F50-\1F57\1F59\1F5B\1F5D\1F5F-\1F7D\1F80-\1FB4\1FB6-\1FBC\1FBE\1FC2-\1FC4\1FC6-\1FCC\1FD0-\1FD3\1FD6-\1FDB\1FE0-\1FEC\1FF2-\1FF4\1FF6-\1FFC\2071\207F\2090-\209C\20D0-\20F0\2102\2107\210A-\2113\2115\2119-\211D\2124\2126\2128\212A-\212D\212F-\2139\213C-\213F\2145-\2149\214E\2183-\2184\2C00-\2CE4\2CEB-\2CF3\2D00-\2D25\2D27\2D2D\2D30-\2D67\2D6F\2D7F-\2D96\2DA0-\2DA6\2DA8-\2DAE\2DB0-\2DB6\2DB8-\2DBE\2DC0-\2DC6\2DC8-\2DCE\2DD0-\2DD6\2DD8-\2DDE\2DE0-\2DFF\2E2F\3005-\3006\302A-\302F\3031-\3035\303B-\303C\3041-\3096\3099-\309A\309D-\309F\30A1-\30FA\30FC-\30FF\3105-\312F\3131-\318E\31A0-\31BF\31F0-\31FF\3400-\4DBF\4E00-\A48C\A4D0-\A4FD\A500-\A60C\A610-\A61F\A62A-\A62B\A640-\A672\A674-\A67D\A67F-\A6E5\A6F0-\A6F1\A717-\A71F\A722-\A788\A78B-\A7DC\A7F1-\A827\A82C\A840-\A873\A880-\A8C5\A8E0-\A8F7\A8FB\A8FD-\A8FF\A90A-\A92D\A930-\A953\A960-\A97C\A980-\A9C0\A9CF\A9E0-\A9EF\A9FA-\A9FE\AA00-\AA36\AA40-\AA4D\AA60-\AA76\AA7A-\AAC2\AADB-\AADD\AAE0-\AAEF\AAF2-\AAF6\AB01-\AB06\AB09-\AB0E\AB11-\AB16\AB20-\AB26\AB28-\AB2E\AB30-\AB5A\AB5C-\AB69\AB70-\ABEA\ABEC-\ABED\AC00-\D7A3\D7B0-\D7C6\D7CB-\D7FB\F900-\FA6D\FA70-\FAD9\FB00-\FB06\FB13-\FB17\FB1D-\FB28\FB2A-\FB36\FB38-\FB3C\FB3E\FB40-\FB41\FB43-\FB44\FB46-\FBB1\FBD3-\FD3D\FD50-\FD8F\FD92-\FDC7\FDF0-\FDFB\FE00-\FE0F\FE20-\FE2F\FE70-\FE74\FE76-\FEFC\FF21-\FF3A\FF41-\FF5A\FF66-\FFBE\FFC2-\FFC7\FFCA-\FFCF\FFD2-\FFD7\FFDA-\FFDC\+010000-\+01000B\+01000D-\+010026\+010028-\+01003A\+01003C-\+01003D\+01003F-\+01004D\+010050-\+01005D\+010080-\+0100FA\+0101FD\+010280-\+01029C\+0102A0-\+0102D0\+0102E0\+010300-\+01031F\+01032D-\+010340\+010342-\+010349\+010350-\+01037A\+010380-\+01039D\+0103A0-\+0103C3\+0103C8-\+0103CF\+010400-\+01049D\+0104B0-\+0104D3\+0104D8-\+0104FB\+010500-\+010527\+010530-\+010563\+010570-\+01057A\+01057C-\+01058A\+01058C-\+010592\+010594-\+010595\+010597-\+0105A1\+0105A3-\+0105B1\+0105B3-\+0105B9\+0105BB-\+0105BC\+0105C0-\+0105F3\+010600-\+010736\+010740-\+010755\+010760-\+010767\+010780-\+010785\+010787-\+0107B0\+0107B2-\+0107BA\+010800-\+010805\+010808\+01080A-\+010835\+010837-\+010838\+01083C\+01083F-\+010855\+010860-\+010876\+010880-\+01089E\+0108E0-\+0108F2\+0108F4-\+0108F5\+010900-\+010915\+010920-\+010939\+010940-\+010959\+010980-\+0109B7\+0109BE-\+0109BF\+010A00-\+010A03\+010A05-\+010A06\+010A0C-\+010A13\+010A15-\+010A17\+010A19-\+010A35\+010A38-\+010A3A\+010A3F\+010A60-\+010A7C\+010A80-\+010A9C\+010AC0-\+010AC7\+010AC9-\+010AE6\+010B00-\+010B35\+010B40-\+010B55\+010B60-\+010B72\+010B80-\+010B91\+010C00-\+010C48\+010C80-\+010CB2\+010CC0-\+010CF2\+010D00-\+010D27\+010D4A-\+010D65\+010D69-\+010D6D\+010D6F-\+010D85\+010E80-\+010EA9\+010EAB-\+010EAC\+010EB0-\+010EB1\+010EC2-\+010EC7\+010EFA-\+010F1C\+010F27\+010F30-\+010F50\+010F70-\+010F85\+010FB0-\+010FC4\+010FE0-\+010FF6\+011000-\+011046\+011070-\+011075\+01107F-\+0110BA\+0110C2\+0110D0-\+0110E8\+011100-\+011134\+011144-\+011147\+011150-\+011173\+011176\+011180-\+0111C4\+0111C9-\+0111CC\+0111CE-\+0111CF\+0111DA\+0111DC\+011200-\+011211\+011213-\+011237\+01123E-\+011241\+011280-\+011286\+011288\+01128A-\+01128D\+01128F-\+01129D\+01129F-\+0112A8\+0112B0-\+0112EA\+011300-\+011303\+011305-\+01130C\+01130F-\+011310\+011313-\+011328\+01132A-\+011330\+011332-\+011333\+011335-\+011339\+01133B-\+011344\+011347-\+011348\+01134B-\+01134D\+011350\+011357\+01135D-\+011363\+011366-\+01136C\+011370-\+011374\+011380-\+011389\+01138B\+01138E\+011390-\+0113B5\+0113B7-\+0113C0\+0113C2\+0113C5\+0113C7-\+0113CA\+0113CC-\+0113D3\+0113E1-\+0113E2\+011400-\+01144A\+01145E-\+011461\+011480-\+0114C5\+0114C7\+011580-\+0115B5\+0115B8-\+0115C0\+0115D8-\+0115DD\+011600-\+011640\+011644\+011680-\+0116B8\+011700-\+01171A\+01171D-\+01172B\+011740-\+011746\+011800-\+01183A\+0118A0-\+0118DF\+0118FF-\+011906\+011909\+01190C-\+011913\+011915-\+011916\+011918-\+011935\+011937-\+011938\+01193B-\+011943\+0119A0-\+0119A7\+0119AA-\+0119D7\+0119DA-\+0119E1\+0119E3-\+0119E4\+011A00-\+011A3E\+011A47\+011A50-\+011A99\+011A9D\+011AB0-\+011AF8\+011B60-\+011B67\+011BC0-\+011BE0\+011C00-\+011C08\+011C0A-\+011C36\+011C38-\+011C40\+011C72-\+011C8F\+011C92-\+011CA7\+011CA9-\+011CB6\+011D00-\+011D06\+011D08-\+011D09\+011D0B-\+011D36\+011D3A\+011D3C-\+011D3D\+011D3F-\+011D47\+011D60-\+011D65\+011D67-\+011D68\+011D6A-\+011D8E\+011D90-\+011D91\+011D93-\+011D98\+011DB0-\+011DDB\+011EE0-\+011EF6\+011F00-\+011F10\+011F12-\+011F3A\+011F3E-\+011F42\+011F5A\+011FB0\+012000-\+012399\+012480-\+012543\+012F90-\+012FF0\+013000-\+01342F\+013440-\+013455\+013460-\+0143FA\+014400-\+014646\+016100-\+01612F\+016800-\+016A38\+016A40-\+016A5E\+016A70-\+016ABE\+016AD0-\+016AED\+016AF0-\+016AF4\+016B00-\+016B36\+016B40-\+016B43\+016B63-\+016B77\+016B7D-\+016B8F\+016D40-\+016D6C\+016E40-\+016E7F\+016EA0-\+016EB8\+016EBB-\+016ED3\+016F00-\+016F4A\+016F4F-\+016F87\+016F8F-\+016F9F\+016FE0-\+016FE1\+016FE3-\+016FE4\+016FF0-\+016FF3\+017000-\+018CD5\+018CFF-\+018D1E\+018D80-\+018DF2\+01AFF0-\+01AFF3\+01AFF5-\+01AFFB\+01AFFD-\+01AFFE\+01B000-\+01B122\+01B132\+01B150-\+01B152\+01B155\+01B164-\+01B167\+01B170-\+01B2FB\+01BC00-\+01BC6A\+01BC70-\+01BC7C\+01BC80-\+01BC88\+01BC90-\+01BC99\+01BC9D-\+01BC9E\+01CF00-\+01CF2D\+01CF30-\+01CF46\+01D165-\+01D169\+01D16D-\+01D172\+01D17B-\+01D182\+01D185-\+01D18B\+01D1AA-\+01D1AD\+01D242-\+01D244\+01D400-\+01D454\+01D456-\+01D49C\+01D49E-\+01D49F\+01D4A2\+01D4A5-\+01D4A6\+01D4A9-\+01D4AC\+01D4AE-\+01D4B9\+01D4BB\+01D4BD-\+01D4C3\+01D4C5-\+01D505\+01D507-\+01D50A\+01D50D-\+01D514\+01D516-\+01D51C\+01D51E-\+01D539\+01D53B-\+01D53E\+01D540-\+01D544\+01D546\+01D54A-\+01D550\+01D552-\+01D6A5\+01D6A8-\+01D6C0\+01D6C2-\+01D6DA\+01D6DC-\+01D6FA\+01D6FC-\+01D714\+01D716-\+01D734\+01D736-\+01D74E\+01D750-\+01D76E\+01D770-\+01D788\+01D78A-\+01D7A8\+01D7AA-\+01D7C2\+01D7C4-\+01D7CB\+01DA00-\+01DA36\+01DA3B-\+01DA6C\+01DA75\+01DA84\+01DA9B-\+01DA9F\+01DAA1-\+01DAAF\+01DF00-\+01DF1E\+01DF25-\+01DF2A\+01E000-\+01E006\+01E008-\+01E018\+01E01B-\+01E021\+01E023-\+01E024\+01E026-\+01E02A\+01E030-\+01E06D\+01E08F\+01E100-\+01E12C\+01E130-\+01E13D\+01E14E\+01E290-\+01E2AE\+01E2C0-\+01E2EF\+01E4D0-\+01E4EF\+01E5D0-\+01E5F0\+01E6C0-\+01E6DE\+01E6E0-\+01E6F5\+01E6FE-\+01E6FF\+01E7E0-\+01E7E6\+01E7E8-\+01E7EB\+01E7ED-\+01E7EE\+01E7F0-\+01E7FE\+01E800-\+01E8C4\+01E8D0-\+01E8D6\+01E900-\+01E94B\+01EE00-\+01EE03\+01EE05-\+01EE1F\+01EE21-\+01EE22\+01EE24\+01EE27\+01EE29-\+01EE32\+01EE34-\+01EE37\+01EE39\+01EE3B\+01EE42\+01EE47\+01EE49\+01EE4B\+01EE4D-\+01EE4F\+01EE51-\+01EE52\+01EE54\+01EE57\+01EE59\+01EE5B\+01EE5D\+01EE5F\+01EE61-\+01EE62\+01EE64\+01EE67-\+01EE6A\+01EE6C-\+01EE72\+01EE74-\+01EE77\+01EE79-\+01EE7C\+01EE7E\+01EE80-\+01EE89\+01EE8B-\+01EE9B\+01EEA1-\+01EEA3\+01EEA5-\+01EEA9\+01EEAB-\+01EEBB\+020000-\+02A6DF\+02A700-\+02B81D\+02B820-\+02CEAD\+02CEB0-\+02EBE0\+02EBF0-\+02EE5D\+02F800-\+02FA1D\+030000-\+03134A\+031350-\+033479\+0E0100-\+0E01EF \002E\0027\002D]+$');
$$;
create or replace function private.validate_patient_contact(p jsonb,complete boolean) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare k text;initials text;phone text;email text;method text;
begin
  if p is null or jsonb_typeof(p)<>'object' or exists(select 1 from jsonb_object_keys(p) x where x not in ('initials','preferredMethod','phone','email'))
    or exists(select 1 from jsonb_each(p) e where jsonb_typeof(e.value)<>'string') then raise exception 'invalid_patient_contact';end if;
  initials:=private.patient_contact_trim(p->>'initials');phone:=private.patient_contact_trim(p->>'phone');email:=private.patient_contact_trim(p->>'email');method:=p->>'preferredMethod';
  if coalesce(length(p->>'initials'),0)>16 or coalesce(length(p->>'phone'),0)>32 or coalesce(length(p->>'email'),0)>254
    or not private.patient_initials_valid(p->>'initials')
    or (complete and coalesce(initials,'')='') then raise exception 'invalid_patient_contact';end if;
  if (method is not null or complete) and coalesce(method,'') not in ('phone','email') then raise exception 'invalid_patient_contact';end if;
  if complete and method='phone' and coalesce(phone,'')<>'' and (phone !~ '^\+?[0-9 ().-]+$' or length(regexp_replace(phone,'[^0-9]','','g')) not between 8 and 15) then raise exception 'invalid_patient_contact';end if;
  if complete and method='email' and coalesce(email,'')<>'' and (email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'
    or email like '.%' or email like '%..%' or email like '%.@%') then raise exception 'invalid_patient_contact';end if;
  if complete then
    if (method='phone' and coalesce(phone,'')='') or (method='email' and coalesce(email,'')='') then raise exception 'invalid_patient_contact';end if;
    return jsonb_build_object('initials',initials,'preferredMethod',method,
      'phone',case when method='phone' then case when phone like '+%' then '+' else '' end||regexp_replace(phone,'[^0-9]','','g') else '' end,
      'email',case when method='email' then lower(email) else '' end);
  end if;
  return p;
end $$;

create or replace function private.directory_recipients(actor uuid,input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare members jsonb:='[]';page jsonb;member_cursor text;result jsonb;fingerprint text;cursor jsonb;
  cursor_key jsonb;fetch_members boolean:=true;member_has_more boolean;
  origin private.postcode_localities;geo_version text;needs jsonb:=nullif(input->'needs','null');
  limit_n integer:=least(50,greatest(1,coalesce((input->>'limit')::integer,25)));
  distance_group text:=coalesce(input->>'distanceGroup','unknown');
begin
  if actor is null or not exists(select 1 from public.organisation_memberships m join auth.users a on a.id=m.user_id
    where m.user_id=actor and m.active and a.email_confirmed_at is not null) then raise exception 'denied' using errcode='42501';end if;
  select source_version into geo_version from private.geography_active;
  fingerprint:=md5(jsonb_build_object('actor',actor,'input',input-'cursor'-'limit','source',geo_version,'operation','recipients-v2')::text);
  cursor:=private.read_page_cursor(input->>'cursor',fingerprint);
  if cursor is not null then
    begin
      cursor_key:=(cursor->>'key')::jsonb;
      if jsonb_typeof(cursor_key)<>'array' or jsonb_array_length(cursor_key)<>4
        or coalesce(cursor_key->>0,'') not in ('0','1') or jsonb_typeof(cursor_key->1)<>'number'
        or jsonb_typeof(cursor_key->2)<>'string'
        or jsonb_typeof(cursor_key->3) not in ('string','null') then raise exception 'invalid_cursor';end if;
      fetch_members:=cursor_key->>0='0' and cursor_key->>3 is not null;
      member_cursor:=case when fetch_members then cursor_key->>3 end;
    exception when others then raise exception 'invalid_cursor';end;
  end if;
  -- Exactly one bounded authoritative member query per combined request. Its
  -- independently computed count stays current even after the member tier ends.
  page:=private.directory_page(actor,(input-'cursor')||jsonb_build_object('limit',case when fetch_members then limit_n else 1 end,'cursor',member_cursor));
  members:=case when fetch_members then page->'items' else '[]'::jsonb end;
  member_has_more:=fetch_members and page->>'nextCursor' is not null;
  if needs is not null and (not exists(select 1 from private.profession_policies where profession_id=needs->>'professionId')
    or needs->>'appointmentFormat' not in ('either','in_person','telehealth')
    or private.normalize_term('funding',needs->>'fundingId') is null
    or (coalesce(needs->>'preferredLanguageId','')<>'' and private.normalize_term('language',needs->>'preferredLanguageId') is null)
    or exists(select 1 from jsonb_array_elements_text(needs->'requiredServiceIds') x where private.normalize_term('service',x) is null)
    or (coalesce(needs->>'patientAgeGroupId','')<>'' and private.normalize_term('ageGroup',needs->>'patientAgeGroupId') is null)) then raise exception 'invalid_request';end if;
  select source_version into geo_version from private.geography_active;
  select * into origin from private.postcode_localities where source_version=geo_version and id=input->>'localityId' and postcode=input->>'postcode';
  with contacts as materialized (
    select r.id,r.candidate_id,r.observation_hash,o.record,loc.location,loc.distance,
      case when needs->>'appointmentFormat'='telehealth' or (loc.location is null and o.record#>'{raw,telehealth}'='true'::jsonb) then 'remote'
        when loc.distance is null then 'unknown' else 'local' end as grp
    from private.directory_contact_routes r join private.practitioner_candidates c on c.id=r.candidate_id
    join private.candidate_observations o on o.id=r.observation_id
    left join lateral (
      select l as location,case when coalesce(needs->>'appointmentFormat','either')<>'telehealth' then
        private.straight_line_km(origin.latitude,origin.longitude,g.latitude,g.longitude) end as distance
      from jsonb_array_elements(o.record->'locations') l left join private.postcode_localities g
        on g.source_version=geo_version and g.id=private.locality_key(l->>'state',l->>'postcode',l->>'suburb')
      where l->>'state'='NSW' and l->>'postcode' ~ '^[0-9]{4}$' and coalesce(l->>'suburb','')<>''
      order by distance nulls last,l->>'suburb' collate "C",l->>'postcode' limit 1
    ) loc on true
    where r.active and c.current_observation_id=o.id and c.disposition not in ('duplicate','unsuitable')
      and exists(select 1 from private.candidate_batch_items i join private.candidate_import_batches b on b.id=i.batch_id where i.observation_id=o.id and b.status='completed')
      and not exists(select 1 from private.email_suppressions s where s.email=r.email)
      and not exists(select 1 from private.candidate_application_links link join public.practitioner_applications app on app.id=link.application_id where link.candidate_id=c.id and app.status='approved')
      and (coalesce(input->>'query','')='' or strpos(lower((o.record->>'displayName')||' '||(o.record->'practiceNames')::text),lower(trim(input->>'query')))>0)
      and (coalesce(input->>'professionId','')='' or o.record->'professionIds' ? (input->>'professionId'))
      and (o.record#>'{raw,accepting_new_referrals}') is distinct from 'false'::jsonb
      and (needs is null or (
        o.record->'professionIds' ? (needs->>'professionId')
        and (needs->>'appointmentFormat'<>'telehealth' or (o.record#>'{raw,telehealth}') is distinct from 'false'::jsonb)
        and (needs->>'appointmentFormat'<>'in_person' or loc.location is not null)
        and (not exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(o.record#>'{raw,funding_types_raw}')='array' then o.record#>'{raw,funding_types_raw}' else '[]' end) x where private.normalize_term('funding',x) is not null)
          or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(o.record#>'{raw,funding_types_raw}')='array' then o.record#>'{raw,funding_types_raw}' else '[]' end) x where private.normalize_term('funding',x)=private.normalize_term('funding',needs->>'fundingId')))
        and (coalesce(needs->>'preferredLanguageId','')='' or not exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(o.record#>'{raw,languages_raw}')='array' then o.record#>'{raw,languages_raw}' else '[]' end) x where private.normalize_term('language',x) is not null)
          or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(o.record#>'{raw,languages_raw}')='array' then o.record#>'{raw,languages_raw}' else '[]' end) x where private.normalize_term('language',x)=private.normalize_term('language',needs->>'preferredLanguageId')))
      ))
  ), options as materialized (
    select (m#>>'{practitioner,id}')::uuid as id,0 as tier,m->>'distanceKm' as distance,
      translate(m#>>'{practitioner,displayName}','ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') collate "C" as name,
      jsonb_build_object('kind','member','practitionerId',m#>>'{practitioner,id}','displayName',m#>>'{practitioner,displayName}',
        'professionId',m#>>'{practitioner,profession}','practiceName',m#>>'{practitioner,practiceName}','location',m#>'{practitioner,location}',
        'distanceKm',m->'distanceKm','reasons',m->'reasons','warnings',m->'warnings','requirementStatus','confirmed') as option
      from jsonb_array_elements(members) m
    union all
    select c.id,1,c.distance::text,translate(c.record->>'displayName','ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') collate "C",
      jsonb_build_object('kind','directory','selection',jsonb_build_object('candidateId',c.candidate_id,'observationHash',c.observation_hash,'routeId',c.id),
        'displayName',c.record->>'displayName','professionId',coalesce(needs->>'professionId',input->>'professionId',c.record#>>'{professionIds,0}'),
        'practiceName',c.record#>>'{practiceNames,0}','location',c.location,'distanceKm',c.distance,
        'reasons',jsonb_build_array('Public business contact available'),
        'warnings',jsonb_build_array('Not yet a ReturnWell member. Registration, funding, services, languages and availability need confirmation.',
          'A clinic inbox may be shared; signing up alone does not grant access to patient details.') ||
          case when c.location is not null and c.distance is null then jsonb_build_array('Distance unavailable; check the practice suburb.') else '[]'::jsonb end,
        'requirementStatus','needs_confirmation')
      from contacts c where c.grp=distance_group and (c.grp<>'local' or input->>'radiusKm' is null or c.distance<=(input->>'radiusKm')::double precision)
  ), keyed as materialized (
    select *,jsonb_build_array(tier,coalesce(distance::double precision,-1),name,case when tier=0 then page->>'nextCursor' end)::text as key from options
  ), page_plus as materialized (
    select * from keyed where cursor is null or
      (tier,coalesce(distance::double precision,-1),name,id)>
      (((cursor->>'key')::jsonb->>0)::integer,((cursor->>'key')::jsonb->>1)::double precision,((cursor->>'key')::jsonb->>2) collate "C",(cursor->>'id')::uuid)
    order by tier,coalesce(distance::double precision,-1),name,id limit limit_n+1
  ), visible as materialized(select * from page_plus order by tier,coalesce(distance::double precision,-1),name,id limit limit_n)
  select jsonb_build_object('items',coalesce((select jsonb_agg(option order by tier,coalesce(distance::double precision,-1),name,id) from visible),'[]'::jsonb),
    'counts',jsonb_build_object('confirmed',page->'totalEligible','needsConfirmation',(select count(*) from options where tier=1)),
    'geography',page->'geography','nextCursor',case when member_has_more or (select count(*) from page_plus)>limit_n then
      (select private.page_cursor(fingerprint,key,id) from visible order by tier desc,coalesce(distance::double precision,-1) desc,name desc,id desc limit 1) end) into result;
  return result;
end $$;

-- A physical-format send must use the same supported NSW location predicate
-- as directory search; unknown location is not evidence of telehealth.
create function private.directory_location_known(record jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
  select exists(select 1 from jsonb_array_elements(record->'locations') l
    where l->>'state'='NSW' and l->>'postcode' ~ '^[0-9]{4}$' and coalesce(l->>'suburb','')<>'');
$$;
do $repair$
declare definition text;old_predicate text:='jsonb_array_length(observation.record->''locations'')=0';
begin
  select pg_get_functiondef('private.directory_invite(uuid,jsonb)'::regprocedure) into definition;
  if strpos(definition,old_predicate)=0 then raise exception 'directory_invite_repair_mismatch';end if;
  execute replace(definition,old_predicate,'not private.directory_location_known(observation.record)');
end $repair$;
revoke all on function private.patient_contact_trim(text),private.patient_initials_valid(text),private.directory_location_known(jsonb) from public,anon,authenticated;
grant execute on function private.patient_contact_trim(text),private.patient_initials_valid(text),private.directory_location_known(jsonb) to service_role;
