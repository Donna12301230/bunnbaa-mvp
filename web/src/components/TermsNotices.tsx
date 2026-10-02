import { getLang } from "@/lib/i18n";

// 會員服務須知／廠商申請須知（登入頁註冊、廠商申請分頁用）。中英兩份內容一起維護，改條款時兩邊都要改。

export function MemberNotice() {
  return getLang() === "en" ? (
    <>
      <p className="font-bold text-orange-800 text-base">Member Terms of Service</p>
      <p className="font-semibold">1. Membership</p>
      <p>Anyone who completes registration and agrees to these terms becomes a BunnBaa member and can browse menus and place orders online.</p>
      <p className="font-semibold">2. Account security</p>
      <ul className="list-disc list-inside space-y-1 pl-1">
        <li>Keep your account and password safe and do not let anyone else use them.</li>
        <li>If you notice unauthorised or unusual activity, contact platform support immediately.</li>
        <li>The platform is not responsible for losses caused by a member's own failure to protect their account.</li>
      </ul>
      <p className="font-semibold">3. Ordering rules</p>
      <ul className="list-disc list-inside space-y-1 pl-1">
        <li>Phase 1 covers weekday (Mon–Fri) breakfast, lunch and dinner pickup. You can book up to 30 days ahead; orders close at <span className="font-semibold">20:00 the day before pickup</span> (a vendor may close earlier).</li>
        <li>Side-dish wishes are decided at cutoff. If a wish doesn't reach the minimum, you get the default side and the order still stands.</li>
        <li>If you have allergies or special dietary needs, note them on your order and confirm directly with the vendor.</li>
        <li><span className="font-semibold">Meals not picked up 30 minutes after the pickup window become charity meals</span>: no refund, but reward tickets are still issued. Before pickup you can donate a meal yourself.</li>
      </ul>
      <p className="font-semibold">4. Cancellations and refunds</p>
      <ul className="list-disc list-inside space-y-1 pl-1">
        <li><span className="font-semibold">Before cutoff</span>: cancel or change for free with a full refund to your original payment method; coupons are returned with their original expiry.</li>
        <li><span className="font-semibold">After cutoff</span>: the vendor has already bought and prepared ingredients, so there are no free cancellations. You can still transfer, gift or donate the meal.</li>
        <li>If a work suspension is announced for the pickup location's county, that day's orders are cancelled and refunded automatically. During disasters the vendor may substitute an equivalent side dish.</li>
        <li>If the vendor fails to serve, you get a full refund.</li>
        <li>Support: herzbaa@gmail.com</li>
      </ul>
      <p className="font-semibold">5. Personal data</p>
      <p>Personal data you provide (name, phone, school and department, etc.) is used only for ordering and contacting you, and is never disclosed or sold to third parties.</p>
      <p className="font-semibold">6. Changes to the service</p>
      <p>The platform may change the service or these terms at any time and will announce changes on the platform. Continuing to use the service means you accept the revised terms.</p>
    </>
  ) : (
    <>
      <p className="font-bold text-orange-800 text-base">會員服務須知</p>
      <p className="font-semibold">一、會員資格</p>
      <p>凡完成會員註冊程序並同意本須知者，即取得飯飽 BunnBaa 會員資格，享有線上瀏覽菜單、下單訂餐等服務。</p>
      <p className="font-semibold">二、帳號安全</p>
      <ul className="list-disc list-inside space-y-1 pl-1">
        <li>會員帳號及密碼請妥善保管，不得轉讓他人使用。</li>
        <li>如發現帳號遭盜用或異常，請立即聯繫平台客服。</li>
        <li>因會員自身疏失導致帳號外洩所造成之損失，平台不負相關責任。</li>
      </ul>
      <p className="font-semibold">三、訂餐規範</p>
      <ul className="list-disc list-inside space-y-1 pl-1">
        <li>第一階段只做週一至週五早、中、晚餐自取。最遠可預訂 30 天後，<span className="font-semibold">取餐日前一天 20:00 截單</span>（店家可提前截單）。</li>
        <li>配菜許願於截單時判定，未達最低量自動改為預設配菜，訂單照常成立。</li>
        <li>如對餐點有過敏或特殊飲食需求，請於備註欄位說明，並直接與廠商確認。</li>
        <li><span className="font-semibold">取餐時段結束 30 分鐘後仍未取餐，便當將轉為愛心餐</span>，不退款但照常發放抽獎券；取餐前也可主動「捐為愛心餐」。</li>
      </ul>
      <p className="font-semibold">四、取消與退款政策</p>
      <ul className="list-disc list-inside space-y-1 pl-1">
        <li><span className="font-semibold">截單前</span>：可免費取消或修改，全額退回原付款方式；用券訂單的折價券退回並保留原到期日。</li>
        <li><span className="font-semibold">截單後</span>：店家已依訂單採購備料，不可免費取消（現做餐點屬易腐敗商品，通訊交易解除權之例外）；可轉讓、贈送或捐為愛心餐。</li>
        <li>取餐地點所在縣市宣布停班時，當日訂單自動取消並全額退款；天災期間店家可等值替換配菜。</li>
        <li>店家未如期出餐，全額退款。</li>
        <li>客服聯絡方式：herzbaa@gmail.com</li>
      </ul>
      <p className="font-semibold">五、個人資料保護</p>
      <p>會員所提供之個人資料（姓名、電話、學校科系等）僅用於訂餐服務及聯絡使用，不會對外揭露或販售給第三方。</p>
      <p className="font-semibold">六、服務變更</p>
      <p>平台保留隨時修改服務內容或本須知之權利，修改後將公告於平台。繼續使用服務即視為同意修訂後之條款。</p>
    </>
  );
}

export function VendorNotice() {
  return getLang() === "en" ? (
    <>
      <p className="font-bold text-amber-800 text-base">Vendor Application Terms</p>
      <p className="font-semibold">1. Eligibility</p>
      <p>Any business legally permitted to sell food may apply to become a BunnBaa vendor. Applicants must provide valid contact details and store information for review.</p>
      <p className="font-semibold">2. Subscription and fees</p>
      <div className="bg-amber-100 rounded-lg p-3 space-y-1">
        <p className="font-semibold text-amber-900">First month free</p>
        <p>Once approved, use every feature free for the first month — no credit card needed.</p>
        <p className="font-semibold text-amber-900 mt-1">From the second month: NT$1,999 / month</p>
        <p>Renews monthly; the fee is charged on each renewal date.</p>
      </div>
      <p className="font-semibold">3. Cancelling and account handling</p>
      <ul className="list-disc list-inside space-y-1 pl-1">
        <li>Vendors may request cancellation within the month before the current period ends.</li>
        <li>After cancellation the account is <span className="font-semibold">suspended</span> and can't sign in or use the platform.</li>
        <li>While suspended, all store data, menus and order history are <span className="font-semibold">kept, not deleted</span>, for up to 2 years.</li>
        <li>To come back, simply resubscribe and everything picks up where it left off.</li>
        <li>Once cancelled, no further charges are made after the period ends. Billing is currently reconciled manually — for billing questions contact herzbaa@gmail.com.</li>
      </ul>
      <p className="font-semibold">4. Service standards</p>
      <ul className="list-disc list-inside space-y-1 pl-1">
        <li>Vendors must ensure their products comply with food safety and hygiene regulations.</li>
        <li>Menu items, prices and availability must be accurate and not misleading.</li>
        <li>Orders must be ready at the scheduled time; notify the platform and customers in advance of any problems.</li>
        <li>Vendors may not cancel confirmed orders without good reason; violations may affect the partnership.</li>
      </ul>
      <p className="font-semibold">5. Account management</p>
      <p>Vendor accounts are for the account holder only and may not be transferred or shared. Keep your password safe and notify the platform immediately if your account is compromised.</p>
      <p className="font-semibold">6. Use of information</p>
      <p>Store information you provide (store name, contact details) is shown publicly on the platform for customers.</p>
      <p className="font-semibold">7. Other</p>
      <p>The platform will announce any changes to these terms in advance. Continuing to use the platform means you accept the revised terms.</p>
    </>
  ) : (
    <>
      <p className="font-bold text-amber-800 text-base">廠商申請須知</p>
      <p className="font-semibold">一、申請資格</p>
      <p>凡具有合法食品販售資格之業者，均可申請成為飯飽 BunnBaa 平台廠商。申請時須提供有效之聯絡方式及店家資訊，以供平台審核。</p>
      <p className="font-semibold">二、訂閱方案與收費</p>
      <div className="bg-amber-100 rounded-lg p-3 space-y-1">
        <p className="font-semibold text-amber-900">首月免費試用</p>
        <p>通過審核後第一個月免費使用全部功能，無需信用卡。</p>
        <p className="font-semibold text-amber-900 mt-1">第二個月起：每月 NT$1,999</p>
        <p>每月自動續約，費用於每月起算日扣款。</p>
      </div>
      <p className="font-semibold">三、取消訂閱與帳號處理</p>
      <ul className="list-disc list-inside space-y-1 pl-1">
        <li>廠商可於當期到期日的前一個月內提出取消申請。</li>
        <li>取消後帳號將進入<span className="font-semibold">暫停狀態</span>，無法登入及使用平台功能。</li>
        <li>帳號暫停期間，所有店家資料、菜單、訂單紀錄<span className="font-semibold">均予保留，不會刪除</span>，保留期限為 2 年。</li>
        <li>如日後希望恢復使用，重新訂閱即可啟用帳號，原有資料完整延續。</li>
        <li>如廠商未確認已取消訂閱，訂閱費用於到期後不再自動扣款；本平台目前採人工對帳方式，如有帳款疑義請聯繫 herzbaa@gmail.com。</li>
      </ul>
      <p className="font-semibold">四、服務規範</p>
      <ul className="list-disc list-inside space-y-1 pl-1">
        <li>廠商應確保所販售之商品符合食品安全衛生相關法規。</li>
        <li>廠商應如實填寫菜單品項、價格及供應時間，不得有虛偽不實之情形。</li>
        <li>廠商應依據訂單於指定時間完成出餐，如遇特殊狀況應提前通知平台及消費者。</li>
        <li>廠商不得無故取消已確認之訂單，如有違反將影響合作資格。</li>
      </ul>
      <p className="font-semibold">五、帳號管理</p>
      <p>廠商帳號限本人使用，不得轉讓或共用。帳號密碼請妥善保管，如發現帳號遭盜用請立即通知平台。</p>
      <p className="font-semibold">六、資料使用</p>
      <p>廠商所提供之店家資訊（店名、聯絡方式）將公開顯示於平台，供消費者查閱。</p>
      <p className="font-semibold">七、其他</p>
      <p>本須知如有修訂，平台將提前公告。繼續使用平台服務即視為同意修訂後之條款。</p>
    </>
  );
}
